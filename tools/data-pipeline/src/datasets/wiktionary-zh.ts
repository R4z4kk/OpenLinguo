import { gunzipSync, gzipSync } from "node:zlib";
import { err, ok, parseWith, type Result } from "@openlinguo/core";
import { joinedToNumbered, type JoinedPinyinError } from "@openlinguo/lang-zh";
import { z } from "zod";
import { parseJsonLineBytes } from "../jsonl.ts";
import { sha256, type Dataset, type ShardReader } from "../run.ts";
import { toShards } from "../shards.ts";
import { countBy, Form, formsTagged, HAN, readingsOf, Sound, Tags, tsv } from "./wiktextract.ts";

/** The fields used from a wiktextract line; other fields are ignored. */
const Line = z.object({
  word: z.string(),
  lang_code: z.literal("zh"),
  pos: z.string(),
  sounds: z.array(Sound).default([]),
  forms: z.array(Form).default([]),
  senses: z.array(
    z.object({
      glosses: z.array(z.string()).default([]),
      raw_glosses: z.array(z.string()).default([]),
      tags: Tags,
    }),
  ),
});
type Line = z.infer<typeof Line>;

/** `[simplified, traditional, numbered pinyin, part of speech, English glosses]` */
export type ExtendedRow = readonly [string, string, string, string, readonly string[]];

export type IssueKind =
  | "non-han-title"
  | "several-readings"
  | "several-simplified-forms"
  | "multiline-gloss"
  | JoinedPinyinError["kind"];

export type Issue = { readonly word: string; readonly kind: IssueKind; readonly detail: string };

export type Skipped = {
  readonly sinograms: number;
  readonly redirects: number;
  readonly unglossed: number;
  readonly inCedict: number;
  readonly noStandardReading: number;
};

export type ExtendedRelease = {
  readonly rows: readonly ExtendedRow[];
  readonly issues: readonly Issue[];
  readonly skipped: Skipped;
};

/** Tags of the Standard Mandarin pinyin rows; any other tag names a dialect or a variant. */
const STANDARD = new Set([
  "Mandarin",
  "Pinyin",
  "Standard",
  "Standard-Chinese",
  "Mainland-China",
  "Taiwan",
  "standard",
]);

/** `Rìběnyǔ [Phonetic: rìbényǔ]` notes the tone sandhi, its bracket sometimes unclosed. */
const withoutPhonetic = (pinyin: string): string => pinyin.replace(/\s*\[[^\]]*(?:\]|$)/gu, "");

const isStandardPinyin = ({ tags }: z.output<typeof Sound>): boolean =>
  tags.includes("Mandarin") &&
  tags.includes("Pinyin") &&
  tags.every((tag) => STANDARD.has(tag)) &&
  (!tags.includes("Taiwan") || tags.includes("Mainland-China"));

/** The most specific gloss of each sense, with its labels (`(Cantonese) …`) when it has some. */
const glossesOf = (line: Line): readonly string[] => [
  ...new Set(
    line.senses
      .filter((sense) => !sense.tags.includes("no-gloss"))
      .map((sense) =>
        ((sense.raw_glosses.length > 0 ? sense.raw_glosses : sense.glosses).at(-1) ?? "").trim(),
      )
      .filter((gloss) => gloss !== ""),
  ),
];

const CedictShard = z.array(z.tuple([z.string(), z.string(), z.string(), z.array(z.string())]));

/** Simplified and traditional headwords of the built CC-CEDICT shards. */
export const loadHeadwords = async (
  readShards: ShardReader,
): Promise<Result<ReadonlySet<string>, string>> => {
  const shards = await readShards("cc-cedict");
  if (!shards.ok) return err(`cannot read cc-cedict: ${shards.error}`);
  if (shards.value.length === 0) return err("cc-cedict must be built before wiktionary-zh");
  const headwords = new Set<string>();
  for (const shard of shards.value) {
    let json: unknown;
    try {
      json = JSON.parse(shard);
    } catch (error) {
      return err(`invalid cc-cedict shard: ${String(error)}`);
    }
    const rows = parseWith(CedictShard, json);
    if (!rows.ok) return err("invalid cc-cedict shard structure");
    for (const [simplified, traditional] of rows.value) headwords.add(simplified).add(traditional);
  }
  return ok(headwords);
};

const compareRows = (a: ExtendedRow, b: ExtendedRow): number => {
  for (const index of [0, 2, 1, 3] as const) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
};

/**
 * Words of English Wiktionary that CC-CEDICT does not have, read from the UTF-8 kaikki.org
 * extract one line at a time (it is past the maximum string length once decompressed).
 */
export const parseEnglishWiktionary = (
  bytes: Uint8Array,
  headwords: ReadonlySet<string>,
): Result<ExtendedRelease, string> => {
  const lines = parseJsonLineBytes(bytes, Line);
  if (!lines.ok) return lines;
  const issues: Issue[] = [];
  const merged = new Map<string, { row: ExtendedRow; glosses: Set<string> }>();
  let sinograms = 0;
  let redirects = 0;
  let unglossed = 0;
  let inCedict = 0;
  let noStandardReading = 0;
  for (const line of lines.value) {
    const issue = (kind: IssueKind, detail: string): void => {
      issues.push({ word: line.word, kind, detail });
    };
    if (line.pos === "character") {
      sinograms += 1;
      continue;
    }
    if (line.pos === "soft-redirect") {
      redirects += 1;
      continue;
    }
    const glosses = glossesOf(line);
    if (glosses.length === 0) {
      unglossed += 1;
      continue;
    }
    const simplifiedForms = formsTagged(line.word, line.forms, "Simplified-Chinese");
    const traditionalForms = formsTagged(line.word, line.forms, "Traditional-Chinese");
    const [simplified = line.word] = simplifiedForms;
    const [onlyTraditional] = traditionalForms;
    const traditional =
      simplifiedForms.length === 0 && traditionalForms.length === 1 && onlyTraditional != null
        ? onlyTraditional
        : line.word;
    if ([line.word, simplified, traditional].some((form) => headwords.has(form))) {
      inCedict += 1;
      continue;
    }
    if (!HAN.test(line.word)) {
      issue("non-han-title", "");
      continue;
    }
    const readings = [
      ...new Set(
        line.sounds
          .filter(isStandardPinyin)
          .flatMap((sound) => readingsOf(withoutPhonetic(sound.zh_pron))),
      ),
    ];
    const [first] = readings;
    if (first == null) {
      noStandardReading += 1;
      continue;
    }
    if (new Set(readings.map((reading) => reading.toLowerCase())).size > 1) {
      issue("several-readings", readings.join(" | "));
    }
    if (simplifiedForms.length > 1) issue("several-simplified-forms", simplifiedForms.join(" | "));
    const reading = joinedToNumbered(first, Array.from(line.word).length);
    if (!reading.ok) {
      issue(reading.error.kind, first);
      continue;
    }
    for (const gloss of glosses.filter((gloss) => gloss.includes("\n"))) {
      issue("multiline-gloss", gloss);
    }
    const kept = glosses.filter((gloss) => !gloss.includes("\n"));
    if (kept.length === 0) continue;
    const key = [simplified, traditional, reading.value, line.pos].join("\t");
    const known = merged.get(key);
    if (known) for (const gloss of kept) known.glosses.add(gloss);
    else {
      merged.set(key, {
        row: [simplified, traditional, reading.value, line.pos, []],
        glosses: new Set(kept),
      });
    }
  }
  const rows = [...merged.values()]
    .map(({ row: [simplified, traditional, reading, pos], glosses }): ExtendedRow => [
      simplified,
      traditional,
      reading,
      pos,
      [...glosses],
    ])
    .sort(compareRows);
  return ok({
    rows,
    issues,
    skipped: { sinograms, redirects, unglossed, inCedict, noStandardReading },
  });
};

const SHARD_SIZE = 10_000;

const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** Shard bytes as stored, and gzipped one file at a time as a server sends them. */
const payloadOf = (shards: ReadonlyMap<string, string>): string => {
  let raw = 0;
  let gzipped = 0;
  for (const content of shards.values()) {
    const bytes = new TextEncoder().encode(content);
    raw += bytes.length;
    gzipped += gzipSync(bytes).length;
  }
  return `${megabytes(raw)} of JSON in ${String(shards.size)} files, ${megabytes(gzipped)} gzipped`;
};

const readme = (
  version: string,
  summary: string,
  payload: string,
): string => `# English Wiktionary — Chinese words absent from CC-CEDICT

Generated by \`tools/data-pipeline\` from the kaikki.org extract ${version}. Do not edit by hand.

- Source: Chinese entries of the English Wiktionary (https://en.wiktionary.org), extracted by Wiktextract and published on https://kaikki.org/dictionary/Chinese/index.html
- Authors: Wiktionary contributors; extraction: Wiktextract (Tatu Ylonen, LREC 2022) and kaikki.org
- License: Creative Commons Attribution-ShareAlike 4.0 International, https://creativecommons.org/licenses/by-sa/4.0/
- Changes: only the words whose simplified and traditional forms are both absent from CC-CEDICT are kept, converted to JSON. \`words-*.json\` holds \`[simplified, traditional, numbered pinyin, part of speech, English glosses]\`, sorted by simplified form then reading; \`name\` marks proper names. One gloss per sense: the most specific one, with its labels (such as "(Cantonese)" or "(literary)") when it has some; entries with the same forms, reading and part of speech are merged. The title is the traditional form, stored under its simplified form (the first one when the entry gives several). The reading is the first Standard Mandarin pinyin of the entry (rows tagged with a dialect, a variant or Taiwan only are not used), split into syllables and converted to numbered pinyin. Sinogram sections (character entries), soft redirects (simplified pages pointing to the traditional entry, which holds the glosses), unglossed entries and words without a Standard Mandarin reading (most of them dialect words: Cantonese, Hokkien, Wu…) are skipped and counted. Entries whose title is not only Chinese characters or whose pinyin is invalid or ambiguous are left out, multi-line glosses are dropped, entries with several readings or simplified forms keep the first one; all are listed in \`issues.tsv\`, never guessed.
- Result: ${summary}.
- Payload: ${payload}.
`;

export const wiktionaryZh: Dataset = {
  id: "wiktionary-zh",
  url: "https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl.gz",
  license: "CC-BY-SA-4.0",
  maxAgeDays: 90,
  build: async (raw, readShards) => {
    let unzipped: Uint8Array;
    try {
      unzipped = gunzipSync(raw);
    } catch (error) {
      return err(`cannot decompress: ${String(error)}`);
    }
    const headwords = await loadHeadwords(readShards);
    if (!headwords.ok) return headwords;
    const release = parseEnglishWiktionary(unzipped, headwords.value);
    if (!release.ok) return release;

    const { rows, issues, skipped } = release.value;
    const names = rows.filter(([, , , pos]) => pos === "name").length;
    const version = `sha256 ${sha256(raw).slice(0, 12)}`;
    const summary = `${String(rows.length)} words kept (${String(names)} names); skipped: ${String(skipped.inCedict)} entries in CC-CEDICT, ${String(skipped.noStandardReading)} without a Standard Mandarin reading, ${String(skipped.sinograms)} sinogram sections, ${String(skipped.redirects)} soft redirects, ${String(skipped.unglossed)} unglossed; issues: ${issues.length === 0 ? "none" : countBy(issues)}`;
    const shards = toShards("words", rows, SHARD_SIZE);
    const files = new Map<string, string>(shards);
    files.set("README.md", readme(version, summary, payloadOf(shards)));
    const issueLines = issues.map(
      (issue) => `${issue.word}\t${issue.kind}\t${issue.detail.replace(/\s+/gu, " ")}`,
    );
    files.set("issues.tsv", tsv("title\tissue\tdetail", [...new Set(issueLines)]));
    return ok({ version, files, summary });
  },
};
