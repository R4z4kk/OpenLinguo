import type { DictionaryLookup, LanguagePack, ProficiencyFramework } from "@openlinguo/core";
import { createDecomposition } from "./decomposition.ts";
import { toDiacritic, tonesOf } from "./pinyin.ts";
import { createSegmenter } from "./segment.ts";

export {
  formatNumbered,
  joinedToNumbered,
  parseNumbered,
  readingKey,
  toDiacritic,
  toNumbered,
  tonesOf,
  type JoinedPinyinError,
  type ReadingToken,
  type Tone,
} from "./pinyin.ts";
export { applySandhi, type ReadingWord, type SandhiError } from "./sandhi.ts";
export { createSegmenter } from "./segment.ts";

export type ZhProficiency = Extract<ProficiencyFramework, "hsk-2025" | "gf0025-2021">;

export type ZhPackSources = {
  readonly lookup: DictionaryLookup;
  /** HSK referential whose levels `lookup` returns. */
  readonly proficiency: ZhProficiency;
  /** Simplified headwords used for segmentation. */
  readonly lexicon: ReadonlySet<string>;
  /** Character → ideographic description sequence (Make Me a Hanzi). */
  readonly decompositions: ReadonlyMap<string, string>;
};

export const createZhPack = ({
  lookup,
  lexicon,
  proficiency,
  decompositions,
}: ZhPackSources): LanguagePack => ({
  id: "zh",
  proficiency,
  tokenize: createSegmenter(lexicon),
  lookup,
  features: {
    tones: { tonesOf },
    strokes: null,
    romanization: { system: "pinyin", toDisplay: toDiacritic },
    decomposition: createDecomposition(lookup, decompositions),
  },
});
