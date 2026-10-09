import { readFile } from "node:fs/promises";
import { err, ok, parseWith, type Result } from "@openlinguo/core";
import * as hb from "harfbuzzjs";
import subsetFont from "subset-font";
import { z } from "zod";
import type { Dataset, ShardReader } from "../run.ts";

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

const fontDataset = (spec: FontSpec): Dataset => ({
  id: spec.id,
  url: spec.url,
  license: "OFL-1.1",
  maxAgeDays: 365,
  build: async (raw, readShards) => {
    const characters = await loadCharacters(readShards);
    if (!characters.ok) return characters;
    let covered: ReadonlySet<number>;
    try {
      covered = new Set(new hb.Face(new hb.Blob(raw)).collectUnicodes());
    } catch (error) {
      return err(`cannot read the font: ${String(error)}`);
    }
    if (covered.size === 0) return err("the font has no character map");
    let license: string;
    try {
      license = await readFile(
        new URL(`../../licenses/${spec.licenseFile}`, import.meta.url),
        "utf8",
      );
    } catch (error) {
      return err(`cannot read ${spec.licenseFile}: ${String(error)}`);
    }

    const plan = planSlices(characters.value, covered);
    const font = Buffer.from(raw);
    const files = new Map<string, string | Uint8Array>();
    const faces: string[] = [];
    for (const slice of plan.slices) {
      const name = `${spec.prefix}-${slice.name}.woff2`;
      try {
        const woff2 = await subsetFont(font, String.fromCodePoint(...slice.codePoints), {
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
    const hsk1 = files.get(`${spec.prefix}-hsk-1.woff2`);
    const summary = `${String(plan.slices.length)} slices, ${String(plan.missing.length)} dataset characters missing from the font, HSK 1 slice ${String(Math.round((hsk1?.length ?? 0) / 1024))} KB`;
    files.set(
      "fonts.css",
      `/* Generated by tools/data-pipeline from ${spec.version}. Do not edit. */\n\n${faces.join("\n")}`,
    );
    files.set("missing.tsv", `${["character", ...plan.missing].join("\n")}\n`);
    files.set("OFL.txt", license);
    files.set("README.md", readme(spec, summary));
    return ok({ version: spec.version, files, summary });
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
