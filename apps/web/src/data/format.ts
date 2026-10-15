import type { GlossLanguage } from "@openlinguo/core";
import { z } from "zod";

/** Gloss sources, in the order of `EntryRow` glosses. */
export const GLOSS_SOURCES = ["cc-cedict", "cfdict", "wiktionary-fr"] as const;
export type GlossSource = (typeof GLOSS_SOURCES)[number];

export const GLOSS_LANGUAGE: Readonly<Record<GlossSource, GlossLanguage>> = {
  "cc-cedict": "en",
  cfdict: "fr",
  "wiktionary-fr": "fr",
};

const Texts = z.array(z.string().min(1));
const Level = z.number().int().min(1).nullable();

/**
 * `[simplified, readingKey, reading, traditional variants, glosses per source, HSK 2025 level,
 * GF0025-2021 level, in the segmentation lexicon, Zipf frequency of the simplified form]`
 */
export const EntryRow = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.string().min(1),
  z.array(z.string().min(1)),
  z.tuple([Texts, Texts, Texts]),
  Level,
  Level,
  z.boolean(),
  z.number().nullable(),
]);
export type EntryRow = z.output<typeof EntryRow>;

const Etymology = z
  .object({
    type: z.string(),
    hint: z.string().nullable(),
    phonetic: z.string().nullable(),
    semantic: z.string().nullable(),
  })
  .nullable();

/** `[character, decomposition (IDS), radical, etymology]` from Make Me a Hanzi. */
export const CharacterRow = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.string().min(1),
  Etymology,
]);
export type CharacterRow = z.output<typeof CharacterRow>;

const Point = z.tuple([z.number(), z.number()]);

/** `[character, stroke outlines (SVG paths), stroke medians]` from hanzi-writer-data, 1024-unit box. */
export const StrokeRow = z
  .tuple([z.string().min(1), z.array(z.string().min(1)).min(1), z.array(z.array(Point).min(2))])
  .refine(([, strokes, medians]) => strokes.length === medians.length, {
    message: "one median per stroke",
  });
export type StrokeRow = z.output<typeof StrokeRow>;

export const Lexicon = z.array(z.string().min(1));

export const DataFile = z.object({
  name: z.string().regex(/^[a-z0-9-]+\.json$/u),
  kind: z.enum(["entries", "characters", "strokes", "lexicon"]),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  rows: z.number().int().nonnegative(),
});
export type DataFile = z.output<typeof DataFile>;

/** `data/index.json`: the files to import, in order; `version` changes with any file. */
export const DataIndex = z.object({ version: z.string().min(1), files: z.array(DataFile).min(1) });
export type DataIndex = z.output<typeof DataIndex>;

/**
 * `[simplified, traditional, numbered pinyin, part of speech, English glosses]`: an English
 * Wiktionary word that CC-CEDICT lacks (`data/wiktionary-zh`); `name` marks proper names.
 */
export const ExtendedRow = z.tuple([
  z.string().min(1),
  z.string().min(1),
  z.string().min(1),
  z.string().min(1),
  Texts.min(1),
]);
export type ExtendedRow = z.output<typeof ExtendedRow>;

export const OnDemandFile = DataFile.omit({ kind: true });
export type OnDemandFile = z.output<typeof OnDemandFile>;

/** `index.json` of a dataset downloaded on demand; `version` changes with any file. */
export const OnDemandIndex = z.object({
  version: z.string().min(1),
  files: z.array(OnDemandFile).min(1),
});
export type OnDemandIndex = z.output<typeof OnDemandIndex>;

/**
 * What jieba's tags say a proper name is: `name` covers transliterated names of people and places
 * alike (`nrt`) and other proper names (`nz`).
 */
export const NameKind = z.enum(["person", "place", "organization", "name"]);
export type NameKind = z.output<typeof NameKind>;

/** `[word, kind]`: a proper name of jieba's dictionary that no shipped lexicon has. */
export const NameRow = z.tuple([z.string().min(1), NameKind]);
export type NameRow = z.output<typeof NameRow>;

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/u);

/** `data/audio-zh/index.json`: the word audio pack of each referential band, downloaded on request. */
export const AudioPackIndex = z.object({
  release: z.string().min(1),
  /** `F0_VERSION` (core f0.ts) of the release's contours; null when it has none. */
  f0: z.string().min(1).nullable().default(null),
  bands: z.array(
    z.object({
      referential: z.enum(["hsk-2025", "gf0025-2021"]),
      level: z.number().int().min(1),
      entries: z.number().int().nonnegative(),
      parts: z
        .array(
          z.object({
            file: z.string().regex(/^audio-zh-[a-z0-9-]+\.zip$/u),
            bytes: z.number().int().positive(),
            sha256: Sha256,
          }),
        )
        .min(1),
    }),
  ),
});
export type AudioPackIndex = z.output<typeof AudioPackIndex>;
export type AudioPackBand = AudioPackIndex["bands"][number];

/** `index.json` in a pack part: its recordings, marked as AI-generated (AI Act art. 50(2), ADR 0007). */
export const AudioPackContent = z.object({
  digitalSourceType: z.string().min(1),
  note: z.string(),
  files: z.array(
    z.object({
      file: z.string().min(1),
      word: z.string().min(1),
      reading: z.string().min(1),
      /** Pitch contour (core f0.ts): null when nothing in the recording is voiced or the pack predates it. */
      f0: z.array(z.number().int().nullable()).nullable().default(null),
    }),
  ),
});
