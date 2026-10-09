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
 * GF0025-2021 level, in the segmentation lexicon]`
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

export const Lexicon = z.array(z.string().min(1));

export const DataFile = z.object({
  name: z.string().regex(/^[a-z0-9-]+\.json$/u),
  kind: z.enum(["entries", "characters", "lexicon"]),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  rows: z.number().int().nonnegative(),
});
export type DataFile = z.output<typeof DataFile>;

/** `data/index.json`: the files to import, in order; `version` changes with any file. */
export const DataIndex = z.object({ version: z.string().min(1), files: z.array(DataFile).min(1) });
export type DataIndex = z.output<typeof DataIndex>;
