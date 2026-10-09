import type { DictionaryLookup, LanguagePack } from "@openlinguo/core";
import { toDiacritic, tonesOf } from "./pinyin.ts";
import { createSegmenter } from "./segment.ts";

export {
  formatNumbered,
  parseNumbered,
  readingKey,
  toDiacritic,
  toNumbered,
  tonesOf,
  type ReadingToken,
  type Tone,
} from "./pinyin.ts";
export { applySandhi, type ReadingWord, type SandhiError } from "./sandhi.ts";
export { createSegmenter } from "./segment.ts";

export type ZhPackSources = {
  readonly lookup: DictionaryLookup;
  /** Simplified headwords used for segmentation. */
  readonly lexicon: ReadonlySet<string>;
};

export const createZhPack = ({ lookup, lexicon }: ZhPackSources): LanguagePack => ({
  id: "zh",
  proficiency: "hsk-2025",
  tokenize: createSegmenter(lexicon),
  lookup,
  features: {
    tones: { tonesOf },
    strokes: null,
    romanization: { system: "pinyin", toDisplay: toDiacritic },
    decomposition: null,
  },
});
