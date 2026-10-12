import { readFile } from "node:fs/promises";
import { err, ok, parseWith, type Result } from "@openlinguo/core";
import * as hb from "harfbuzzjs";
import subsetFont from "subset-font";
import { z } from "zod";
import type { Dataset, ShardReader } from "../run.ts";
import { nameText, readNames, renameFont } from "../sfnt.ts";

/** Non-Han slices: pinyin letters and tone marks, common Chinese punctuation, rarer symbols. */
const BASE_SLICES: readonly (readonly [string, readonly (readonly [number, number])[]])[] = [
  [
    "latin",
    [
      [0x0020, 0x007e],
      [0x00a0, 0x017f],
      [0x01cd, 0x01dc],
      [0x02c7, 0x02c7],
      [0x02c9, 0x02cb],
      [0x02d9, 0x02d9],
    ],
  ],
  [
    "punctuation",
    [
      [0x2010, 0x2027],
      [0x3000, 0x301f],
      [0xff01, 0xff5e],
    ],
  ],
  [
    "symbols",
    [
      [0x2000, 0x200f],
      [0x2028, 0x206f],
      [0x3020, 0x303f],
      [0xff5f, 0xffef],
    ],
  ],
];
const HAN = /\p{Script=Han}/gu;
const LEVELS = "hsk-2025-chars";
const EXTRAS = "gf0025-2021-chars";
/** Datasets whose text the app can display. */
const TEXTS = [
  "cc-cedict",
  "cfdict",
  "wiktionary-fr-zh",
  "makemeahanzi",
  "hsk-2025-words",
  "gf0025-2021-words",
];
const BANDS = ["1", "2", "3", "4", "5", "6", "7-9"];
const CHUNK = 400;

const CharacterShard = z.array(z.tuple([z.string(), z.number().int()]));

export type Slice = { readonly name: string; readonly codePoints: readonly number[] };

export type Characters = {
  /** HSK 2025 characters of each band, in band order. */
  readonly levels: readonly (readonly string[])[];
  /** GF0025-2021 characters. */
  readonly extras: readonly string[];
  /** Every other character of the datasets, most frequent first. */
  readonly others: readonly string[];
};

/**
 * A base slice, one slice per HSK 2025 band, the GF0025-2021 characters, then the other
 * characters in chunks. Characters the font lacks are listed, never sliced.
 */
export const planSlices = (
  characters: Characters,
  covered: ReadonlySet<number>,
): { readonly slices: readonly Slice[]; readonly missing: readonly string[] } => {
  const seen = new Set<number>();
  const missing: string[] = [];
  const slices: Slice[] = [];
  const add = (name: string, codePoints: readonly number[]): void => {
    if (codePoints.length > 0)
      slices.push({ name, codePoints: [...codePoints].sort((a, b) => a - b) });
  };
  const take = (chars: readonly string[]): number[] => {
    const kept: number[] = [];
    for (const char of chars) {
      const codePoint = char.codePointAt(0);
      if (codePoint == null || seen.has(codePoint)) continue;
      seen.add(codePoint);
      if (covered.has(codePoint)) kept.push(codePoint);
      else missing.push(char);
    }
    return kept;
  };

  for (const [name, ranges] of BASE_SLICES) {
    const codePoints = ranges
      .flatMap(([start, end]) =>
        Array.from({ length: end - start + 1 }, (_, offset) => start + offset),
      )
      .filter((codePoint) => covered.has(codePoint));
    for (const codePoint of codePoints) seen.add(codePoint);
    add(name, codePoints);
  }
  characters.levels.forEach((chars, index) => {
    add(`hsk-${BANDS[index] ?? String(index + 1)}`, take(chars));
  });
  add("gf0025", take(characters.extras));
  const rest = take(characters.others);
  for (let start = 0; start < rest.length; start += CHUNK) {
    add(`more-${String(start / CHUNK + 1).padStart(2, "0")}`, rest.slice(start, start + CHUNK));
  }
  return { slices, missing };
};

/** Compact CSS `unicode-range` of sorted code points. */
export const unicodeRange = (codePoints: readonly number[]): string => {
  const parts: string[] = [];
  const hex = (codePoint: number): string => codePoint.toString(16);
  let start = codePoints[0];
  let previous = start;
  for (const codePoint of [...codePoints.slice(1), Number.NaN]) {
    if (start == null || previous == null) break;
    if (codePoint === previous + 1) {
      previous = codePoint;
      continue;
    }
    parts.push(start === previous ? `U+${hex(start)}` : `U+${hex(start)}-${hex(previous)}`);
    start = codePoint;
    previous = codePoint;
  }
  return parts.join(",");
};

const readCharacterShards = async (
  readShards: ShardReader,
  dataset: string,
): Promise<Result<readonly (readonly [string, number])[], string>> => {
  const shards = await readShards(dataset);
  if (!shards.ok) return err(`cannot read ${dataset}: ${shards.error}`);
  if (shards.value.length === 0) return err(`${dataset} must be built before the fonts`);
  const rows: (readonly [string, number])[] = [];
  for (const shard of shards.value) {
    let json: unknown;
    try {
      json = JSON.parse(shard);
    } catch (error) {
      return err(`invalid ${dataset} shard: ${String(error)}`);
    }
    const parsed = parseWith(CharacterShard, json);
    if (!parsed.ok) return err(`invalid ${dataset} shard structure`);
    rows.push(...parsed.value);
  }
  return ok(rows);
};

export const loadCharacters = async (
  readShards: ShardReader,
): Promise<Result<Characters, string>> => {
  const levelRows = await readCharacterShards(readShards, LEVELS);
  if (!levelRows.ok) return levelRows;
  const extraRows = await readCharacterShards(readShards, EXTRAS);
  if (!extraRows.ok) return extraRows;
  const counts = new Map<string, number>();
  for (const dataset of TEXTS) {
    const shards = await readShards(dataset);
    if (!shards.ok) return err(`cannot read ${dataset}: ${shards.error}`);
    if (shards.value.length === 0) return err(`${dataset} must be built before the fonts`);
    for (const shard of shards.value) {
      for (const [char] of shard.matchAll(HAN)) counts.set(char, (counts.get(char) ?? 0) + 1);
    }
  }
  return ok({
    levels: BANDS.map((_, index) =>
      levelRows.value.filter(([, level]) => level === index + 1).map(([char]) => char),
    ),
    extras: extraRows.value.map(([char]) => char),
    others: [...counts]
      .sort(([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : 1))
      .map(([char]) => char),
  });
};

type FontSpec = {
  readonly id: string;
  readonly url: string;
  readonly family: string;
  readonly weight: number;
  readonly prefix: string;
  readonly version: string;
  readonly licenseFile: string;
  readonly attribution: string;
};

const readme = (spec: FontSpec, summary: string): string => `# ${spec.family} ${String(spec.weight)}

Generated by \`tools/data-pipeline\` from ${spec.version}. Do not edit by hand.

- Source: ${spec.url}
- ${spec.attribution}
- License: SIL Open Font License 1.1 (\`OFL.txt\`), no Reserved Font Name
- Changes: this font has been modified. It is split into WOFF2 subsets loaded through \`unicode-range\` (\`fonts.css\`): Latin with pinyin tone marks, common punctuation, rarer symbols, one slice per HSK 2025 band, the GF0025-2021 characters, then the other characters of the shipped datasets, most frequent first. OpenType alternates (vertical, full-width and proportional forms) are not kept: the app sets horizontal simplified Chinese only. Dataset characters the font lacks are listed in \`missing.tsv\` and fall back to the next font.
- Result: ${summary}.
`;

const readFont = (raw: Uint8Array): Result<ReadonlySet<number>, string> => {
  try {
    const covered = new Set(new hb.Face(new hb.Blob(raw)).collectUnicodes());
    return covered.size === 0 ? err("the font has no character map") : ok(covered);
  } catch (error) {
    return err(`cannot read the font: ${String(error)}`);
  }
};

const readLicense = async (file: string): Promise<Result<string, string>> => {
  try {
    return ok(await readFile(new URL(`../../licenses/${file}`, import.meta.url), "utf8"));
  } catch (error) {
    return err(`cannot read ${file}: ${String(error)}`);
  }
};

/** One WOFF2 file per slice and the \`fonts.css\` declaring them, by file name. */
const writeSlices = async (
  font: Uint8Array,
  spec: Pick<FontSpec, "family" | "weight" | "prefix" | "version">,
  slices: readonly Slice[],
): Promise<Result<Map<string, string | Uint8Array>, string>> => {
  const buffer = Buffer.from(font);
  const files = new Map<string, string | Uint8Array>();
  const faces: string[] = [];
  for (const slice of slices) {
    const name = `${spec.prefix}-${slice.name}.woff2`;
    try {
      const woff2 = await subsetFont(buffer, String.fromCodePoint(...slice.codePoints), {
        targetFormat: "woff2",
        noLayoutClosure: true,
      });
      files.set(name, new Uint8Array(woff2));
    } catch (error) {
      return err(`cannot subset ${slice.name}: ${String(error)}`);
    }
    faces.push(`@font-face {
  font-family: "${spec.family}";
  font-style: normal;
  font-weight: ${String(spec.weight)};
  font-display: swap;
  src: url("./${name}") format("woff2");
  unicode-range: ${unicodeRange(slice.codePoints)};
}
`);
  }
  files.set(
    "fonts.css",
    `/* Generated by tools/data-pipeline from ${spec.version}. Do not edit. */\n\n${faces.join("\n")}`,
  );
  return ok(files);
};

const missingList = (missing: readonly string[]): string =>
  `${["character", ...missing].join("\n")}\n`;

const fontDataset = (spec: FontSpec): Dataset => ({
  id: spec.id,
  url: spec.url,
  license: "OFL-1.1",
  maxAgeDays: 365,
  build: async (raw, readShards) => {
    const characters = await loadCharacters(readShards);
    if (!characters.ok) return characters;
    const covered = readFont(raw);
    if (!covered.ok) return covered;
    const license = await readLicense(spec.licenseFile);
    if (!license.ok) return license;

    const plan = planSlices(characters.value, covered.value);
    const files = await writeSlices(raw, spec, plan.slices);
    if (!files.ok) return files;
    const hsk1 = files.value.get(`${spec.prefix}-hsk-1.woff2`);
    const summary = `${String(plan.slices.length)} slices, ${String(plan.missing.length)} dataset characters missing from the font, HSK 1 slice ${String(Math.round((hsk1?.length ?? 0) / 1024))} KB`;
    files.value.set("missing.tsv", missingList(plan.missing));
    files.value.set("OFL.txt", license.value);
    files.value.set("README.md", readme(spec, summary));
    return ok({ version: spec.version, files: files.value, summary });
  },
});

/** Characters of \`missing.tsv\` lists, in list order, without repeats. */
export const parseMissing = (lists: readonly string[]): readonly string[] => [
  ...new Set(
    lists.flatMap((list) =>
      list
        .split("\n")
        .slice(1)
        .filter((line) => line !== ""),
    ),
  ),
];

/** The characters a fallback font covers, by slice, and those it lacks too. */
export const planFallback = (
  characters: readonly string[],
  covered: ReadonlySet<number>,
): { readonly slices: readonly Slice[]; readonly missing: readonly string[] } => {
  const kept = characters.filter((char) => covered.has(char.codePointAt(0) ?? -1));
  const slices: Slice[] = [];
  for (let start = 0; start < kept.length; start += CHUNK) {
    slices.push({
      name: String(start / CHUNK + 1).padStart(2, "0"),
      codePoints: kept
        .slice(start, start + CHUNK)
        .map((char) => char.codePointAt(0) ?? 0)
        .sort((a, b) => a - b),
    });
  }
  return { slices, missing: characters.filter((char) => !covered.has(char.codePointAt(0) ?? -1)) };
};

type FallbackSpec = FontSpec & {
  /** Name of the font this one is modified from, which its license reserves. */
  readonly source: string;
  readonly reservedNames: readonly string[];
  /** Name table of the renamed font: family, unique id, full name, PostScript name. */
  readonly names: {
    readonly 1: string;
    readonly 3: string;
    readonly 4: string;
    readonly 6: string;
  };
  /** Datasets whose \`missing.tsv\` characters this font renders, if it has them. */
  readonly after: readonly string[];
};

const fallbackReadme = (
  spec: FallbackSpec,
  summary: string,
): string => `# ${spec.family} (${spec.source})

Generated by \`tools/data-pipeline\` from ${spec.version}. Do not edit by hand.

- Source: ${spec.url}
- ${spec.attribution}
- License: SIL Open Font License 1.1 (\`OFL.txt\`). The names ${spec.reservedNames.map((name) => `"${name}"`).join(" and ")} are reserved, so this modified version is renamed "${spec.family}".
- Changes: this font has been modified. It keeps only the dataset characters that ${spec.after.map((id) => `\`${id}\``).join(", ")} lack (their \`missing.tsv\`), split into WOFF2 subsets loaded through \`unicode-range\` (\`fonts.css\`), and its name table is rewritten. The characters it lacks too are listed in \`missing.tsv\`.
- Result: ${summary}.
`;

const RENAMED_IDS = [1, 3, 4, 6] as const;
/** Typographic, compatible, WWS family names and the trademark notice of the original font. */
const DROPPED_IDS = [7, 16, 17, 18, 21, 22];

const fallbackDataset = (spec: FallbackSpec): Dataset => ({
  id: spec.id,
  url: spec.url,
  license: "OFL-1.1",
  maxAgeDays: 365,
  build: async (raw, _readShards, readList) => {
    const lists: string[] = [];
    for (const dataset of spec.after) {
      const list = await readList(dataset, "missing.tsv");
      if (!list.ok) return err(`${dataset} must be built before ${spec.id}: ${list.error}`);
      lists.push(list.value);
    }
    const covered = readFont(raw);
    if (!covered.ok) return covered;
    const license = await readLicense(spec.licenseFile);
    if (!license.ok) return license;

    const renamed = renameFont(
      raw,
      new Map<number, string | null>([
        ...RENAMED_IDS.map((id) => [id, spec.names[id]] as const),
        ...DROPPED_IDS.map((id) => [id, null] as const),
      ]),
    );
    if (!renamed.ok) return err(`cannot rename the font: ${renamed.error}`);
    const names = readNames(renamed.value);
    if (!names.ok) return names;
    const reserved = names.value.find((record) =>
      spec.reservedNames.some((name) =>
        nameText(record).toLowerCase().includes(name.toLowerCase()),
      ),
    );
    if (reserved != null)
      return err(`reserved font name left in name id ${String(reserved.nameId)}`);

    const plan = planFallback(parseMissing(lists), covered.value);
    const files = await writeSlices(renamed.value, spec, plan.slices);
    if (!files.ok) return files;
    const size = plan.slices.reduce(
      (total, { name }) => total + (files.value.get(`${spec.prefix}-${name}.woff2`)?.length ?? 0),
      0,
    );
    const kept = plan.slices.reduce((total, { codePoints }) => total + codePoints.length, 0);
    const summary = `${String(plan.slices.length)} ${plan.slices.length === 1 ? "slice" : "slices"}, ${String(kept)} characters in ${String(Math.round(size / 1024))} KB, ${String(plan.missing.length)} dataset characters missing from the font`;
    files.value.set("missing.tsv", missingList(plan.missing));
    files.value.set("OFL.txt", license.value);
    files.value.set("README.md", fallbackReadme(spec, summary));
    return ok({ version: spec.version, files: files.value, summary });
  },
});

const NOTO_COMMIT = "f8d157532fbfaeda587e826d4cd5b21a49186f7c";
const NOTO_BASE = `https://raw.githubusercontent.com/notofonts/noto-cjk/${NOTO_COMMIT}/Sans/SubsetOTF/SC`;
const NOTO_ATTRIBUTION =
  "Author: Adobe and Google (Noto Sans CJK, https://github.com/notofonts/noto-cjk)";

export const notoSansSc400 = fontDataset({
  id: "font-noto-sans-sc-400",
  url: `${NOTO_BASE}/NotoSansSC-Regular.otf`,
  family: "Noto Sans SC",
  weight: 400,
  prefix: "noto-sans-sc-400",
  version: `notofonts/noto-cjk@${NOTO_COMMIT.slice(0, 7)}`,
  licenseFile: "noto-cjk-OFL.txt",
  attribution: NOTO_ATTRIBUTION,
});

export const notoSansSc700 = fontDataset({
  id: "font-noto-sans-sc-700",
  url: `${NOTO_BASE}/NotoSansSC-Bold.otf`,
  family: "Noto Sans SC",
  weight: 700,
  prefix: "noto-sans-sc-700",
  version: `notofonts/noto-cjk@${NOTO_COMMIT.slice(0, 7)}`,
  licenseFile: "noto-cjk-OFL.txt",
  attribution: NOTO_ATTRIBUTION,
});

export const lxgwWenKaiGb = fontDataset({
  id: "font-lxgw-wenkai-gb",
  url: "https://github.com/lxgw/LxgwWenkaiGB/releases/download/v1.522/LXGWWenKaiGB-Regular.ttf",
  family: "LXGW WenKai GB",
  weight: 400,
  prefix: "lxgw-wenkai-gb",
  version: "LXGW WenKai GB v1.522",
  licenseFile: "lxgw-wenkai-gb-OFL.txt",
  attribution: "Author: LXGW (https://github.com/lxgw/LxgwWenkaiGB), from Klee One by Fontworks",
});

const PLANGOTHIC_TAG = "V2.9.5795";
const PLANGOTHIC_BASE = `https://github.com/Fitzgerald-Porthmouth-Koenigsegg/Plangothic-Project/releases/download/${PLANGOTHIC_TAG}`;
const HAN_FALLBACK = "OpenLinguo Han Fallback";

const plangothic = (part: "P1" | "P2", after: readonly string[]): Dataset =>
  fallbackDataset({
    id: `font-plangothic-${part.toLowerCase()}`,
    url: `${PLANGOTHIC_BASE}/Plangothic${part}-Regular.ttf`,
    family: HAN_FALLBACK,
    weight: 400,
    prefix: `han-fallback-${part.toLowerCase()}`,
    version: `Plangothic ${PLANGOTHIC_TAG}`,
    licenseFile: "plangothic-OFL.txt",
    attribution:
      "Author: Fitzgerald P. Köeingsegg and the Plangothic Project contributors (https://github.com/Fitzgerald-Porthmouth-Koenigsegg/Plangothic-Project), from Source Han Sans by Adobe",
    source: `Plangothic ${part}`,
    reservedNames: ["Plangothic", "遍黑"],
    names: {
      1: HAN_FALLBACK,
      3: `${HAN_FALLBACK} ${part}`,
      4: HAN_FALLBACK,
      6: `OpenLinguoHanFallback-${part}`,
    },
    after,
  });

/** The dataset characters Noto Sans SC or LXGW WenKai GB lack, from the CJK extension planes. */
export const plangothicP1 = plangothic("P1", [notoSansSc400.id, notoSansSc700.id, lxgwWenKaiGb.id]);

/** What Plangothic P1 lacks: the last font of the chain. */
export const plangothicP2 = plangothic("P2", [plangothicP1.id]);
