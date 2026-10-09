import { err, ok, type Result } from "@openlinguo/core";
import type { Dataset } from "../run.ts";
import { toShards } from "../shards.ts";
import { joinFrenchEntries, loadCedictIndex } from "./cedict-join.ts";

export type CfdictEntry = {
  readonly id: string;
  readonly updatedAt: number;
  readonly traditional: string;
  readonly simplified: string;
  readonly reading: string;
  readonly glosses: readonly string[];
};

export type Repair = { readonly entryId: string; readonly description: string };

export type CfdictRelease = {
  readonly version: string;
  readonly entries: readonly CfdictEntry[];
  readonly repairs: readonly Repair[];
};

const VERSION = /- Version : (\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/u;
const ANNOUNCED = /- Nombre de traductions : environ ([\d\s]+)\n/u;
const PROLOGUE = /^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<!--[\s\S]*?\/\/-->\s*<dic>/u;
const WORD = /<word>([\s\S]*?)<\/word>/gu;
const BLOCK =
  /^\s*<id>(\d+)<\/id>\s*<upd>(\d+)<\/upd>\s*<trad>([^<]+)<\/trad>\s*<simp>([^<]+)<\/simp>\s*<py>([^<]+)<\/py>\s*<trans>([\s\S]*)<\/trans>\s*$/u;
const FR = /<fr><!\[CDATA\[((?:[^\]]|\](?!\]>))*)\]\]><\/fr>/gu;
const COUNT_TOLERANCE = 0.01;
const MAX_REPORTED = 10;

const STRAY_LEAD = 0xc2;
const BROKEN_CHECK_MARK = [0xe2, 0x6f, 0x65, 0x93];
const CHECK_MARK = [0xe2, 0x9c, 0x93];

const sequenceLength = (lead: number): number => {
  if (lead < 0x80) return 1;
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0;
};

const isValidSequence = (bytes: Uint8Array, index: number): boolean => {
  const length = sequenceLength(bytes[index] ?? 0);
  if (length === 0 || index + length > bytes.length) return false;
  for (let offset = 1; offset < length; offset++) {
    if (((bytes[index + offset] ?? 0) & 0xc0) !== 0x80) return false;
  }
  return true;
};

const startsWith = (bytes: Uint8Array, index: number, pattern: readonly number[]): boolean =>
  pattern.every((byte, offset) => bytes[index + offset] === byte);

const entryIdAt = (bytes: Uint8Array, index: number): string => {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = buffer.lastIndexOf("<id>", index);
  const end = buffer.indexOf("</id>", start);
  return start < 0 || end < 0 ? "header" : buffer.toString("latin1", start + 4, end);
};

/** Repairs the two corruptions found in the official file; any other invalid byte fails. */
export const repairCfdictBytes = (
  raw: Uint8Array,
): Result<{ readonly xml: string; readonly repairs: readonly Repair[] }, string> => {
  const output: number[] = [];
  const repairs: Repair[] = [];
  for (let index = 0; index < raw.length;) {
    if (isValidSequence(raw, index)) {
      const length = sequenceLength(raw[index] ?? 0);
      for (let offset = 0; offset < length; offset++) output.push(raw[index + offset] ?? 0);
      index += length;
    } else if (startsWith(raw, index, BROKEN_CHECK_MARK)) {
      output.push(...CHECK_MARK);
      repairs.push({ entryId: entryIdAt(raw, index), description: "broken check mark restored" });
      index += BROKEN_CHECK_MARK.length;
    } else if (raw[index] === STRAY_LEAD && (raw[index + 1] ?? 0x80) < 0x80) {
      repairs.push({ entryId: entryIdAt(raw, index), description: "stray 0xC2 byte removed" });
      index += 1;
    } else {
      const context = Buffer.from(raw.subarray(index, index + 8)).toString("hex");
      return err(
        `invalid UTF-8 at byte ${String(index)} (entry ${entryIdAt(raw, index)}): ${context}`,
      );
    }
  }
  try {
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(output));
    return ok({ xml, repairs });
  } catch (error) {
    return err(`cannot decode after repairs: ${String(error)}`);
  }
};

export const parseCfdict = (xml: string): Result<CfdictRelease, string> => {
  const version = VERSION.exec(xml);
  const announced = ANNOUNCED.exec(xml);
  if (version == null || announced?.[1] == null) {
    return err("header is missing the version or the announced entry count");
  }
  const [day = "", month = "", year = "", hour = "", minute = ""] = version.slice(1);
  const prologue = PROLOGUE.exec(xml);
  if (prologue == null) return err("unexpected document prologue");
  const body = xml.slice(prologue[0].length);
  if (body.replace(WORD, "").trim() !== "</dic>") return err("unexpected content outside <word>");

  const entries: CfdictEntry[] = [];
  const invalid: string[] = [];
  const repairs: Repair[] = [];
  for (const [index, [, block = ""]] of [...body.matchAll(WORD)].entries()) {
    const match = BLOCK.exec(block);
    const translations = match?.[6] ?? "";
    const rawGlosses = [...translations.matchAll(FR)].map(([, text = ""]) => text.trim());
    const onlyGlosses = translations.replace(FR, "").trim() === "";
    const glosses = rawGlosses.filter((gloss) => gloss !== "");
    const [, id, upd, traditional, simplified, reading] = match ?? [];
    if (
      id == null ||
      upd == null ||
      traditional == null ||
      simplified == null ||
      reading == null ||
      !onlyGlosses ||
      glosses.length === 0
    ) {
      invalid.push(id ?? `#${String(index + 1)}`);
      continue;
    }
    if (glosses.length < rawGlosses.length) {
      repairs.push({ entryId: id, description: "empty French gloss removed" });
    }
    const raw = [traditional, simplified, reading];
    const fields = raw.map((field) => field.trim());
    const [cleanTraditional = "", cleanSimplified = "", cleanReading = ""] = fields;
    if (fields.some((field) => field === "" || /[\t\n]/u.test(field))) {
      invalid.push(id);
      continue;
    }
    if (fields.some((field, position) => field !== raw[position])) {
      repairs.push({ entryId: id, description: "whitespace around a field removed" });
    }
    entries.push({
      id,
      updatedAt: Number(upd),
      traditional: cleanTraditional,
      simplified: cleanSimplified,
      reading: cleanReading,
      glosses,
    });
  }

  if (invalid.length > 0) {
    const shown = invalid.slice(0, MAX_REPORTED).join(", ");
    return err(`${String(invalid.length)} malformed entries (${shown})`);
  }
  const expected = Number(announced[1].replace(/\D/gu, ""));
  if (Math.abs(entries.length - expected) > expected * COUNT_TOLERANCE) {
    return err(
      `header announces about ${String(expected)} entries, parsed ${String(entries.length)}`,
    );
  }
  const versionTime = Date.UTC(Number(year), Number(month) - 1, Number(day) + 1) / 1000;
  const latest = entries.reduce((max, entry) => Math.max(max, entry.updatedAt), 0);
  if (latest > versionTime) {
    return err(
      `an entry was updated after the header version (${new Date(latest * 1000).toISOString()})`,
    );
  }
  return ok({ version: `${year}-${month}-${day}T${hour}:${minute}`, entries, repairs });
};

const SHARD_SIZE = 10_000;

const tsv = (header: string, lines: readonly string[]): string =>
  `${[header, ...lines].join("\n")}\n`;

const readme = (version: string, summary: string): string => `# CFDICT

Generated by \`tools/data-pipeline\` from the CFDICT release dated ${version}. Do not edit by hand.

- Source: https://chine.in/chinois/open/CFDICT/ (official site: https://chine.in)
- Publisher: Chine Informations
- License: Creative Commons Attribution-ShareAlike 3.0 Unported, https://creativecommons.org/licenses/by-sa/3.0/
- Changes: converted to JSON. \`glosses-*.json\` holds \`[simplified, lowercase numbered pinyin, French glosses]\` attached to the CC-CEDICT entry with that key; \`entries-*.json\` holds \`[simplified, traditional, numbered pinyin, French glosses]\` for words CC-CEDICT does not have. A French entry joins a CC-CEDICT entry on simplified + pinyin, on the CC-CEDICT traditional form when CFDICT stored it as simplified, ignoring a neutral-tone difference, or despite a tone conflict when only one CC-CEDICT entry has the same syllables (CC-CEDICT tone kept, listed in \`tone-conflicts.tsv\`). A toneless syllable (\`a\`, erhua \`r\`) is read as the neutral tone. Entries with an invalid pinyin or a space inside the headword are listed in \`rejected.tsv\`. Defects of the official file (stray 0xC2 lead bytes, a broken check mark, empty glosses) are repaired and listed in \`repairs.tsv\`.
- Result: ${summary}.
`;

export const cfdict: Dataset = {
  id: "cfdict",
  url: "https://chine.in/assets/cfdict/cfdict.xml",
  license: "CC-BY-SA-3.0",
  maxAgeDays: 90,
  build: async (raw, readShards) => {
    const decoded = repairCfdictBytes(raw);
    if (!decoded.ok) return decoded;
    const release = parseCfdict(decoded.value.xml);
    if (!release.ok) return release;
    const repairs = [...decoded.value.repairs, ...release.value.repairs];
    const index = await loadCedictIndex(readShards, "cfdict");
    if (!index.ok) return index;

    const join = joinFrenchEntries(index.value, release.value.entries);
    const summary = `${String(release.value.entries.length)} entries, ${join.summary}, ${String(repairs.length)} repairs`;
    const files = new Map([
      ...toShards("glosses", join.glossRows, SHARD_SIZE),
      ...toShards("entries", join.entryRows, SHARD_SIZE),
    ]);
    files.set("README.md", readme(release.value.version, summary));
    files.set(
      "tone-conflicts.tsv",
      tsv("entry_id\tsimplified\tcfdict_pinyin\tcc_cedict_pinyin", join.conflicts),
    );
    files.set(
      "rejected.tsv",
      tsv(
        "entry_id\tsimplified\tpinyin",
        join.rejected.map((entry) => `${entry.id}\t${entry.simplified}\t${entry.reading}`),
      ),
    );
    files.set(
      "repairs.tsv",
      tsv(
        "entry_id\trepair",
        repairs.map((repair) => `${repair.entryId}\t${repair.description}`),
      ),
    );
    return ok({ version: release.value.version, files, summary });
  },
};
