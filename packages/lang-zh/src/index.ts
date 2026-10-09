import { intlTokenizer, type DictionaryLookup, type LanguagePack } from "@openlinguo/core";
import { toDiacritic, tonesOf } from "./pinyin.ts";

export {
  formatNumbered,
  parseNumbered,
  toDiacritic,
  toNumbered,
  tonesOf,
  type ReadingToken,
  type Tone,
} from "./pinyin.ts";
export { applySandhi, type ReadingWord, type SandhiError } from "./sandhi.ts";

export const createZhPack = (lookup: DictionaryLookup): LanguagePack => ({
  id: "zh",
  proficiency: "hsk-2025",
  tokenize: intlTokenizer("zh-Hans"),
  lookup,
  features: {
    tones: { tonesOf },
    strokes: null,
    romanization: { system: "pinyin", toDisplay: toDiacritic },
    decomposition: null,
  },
});
