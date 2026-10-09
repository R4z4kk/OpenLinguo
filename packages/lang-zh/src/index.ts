import { intlTokenizer, type DictionaryLookup, type LanguagePack } from "@openlinguo/core";

export const createZhPack = (lookup: DictionaryLookup): LanguagePack => ({
  id: "zh",
  proficiency: "hsk-2025",
  tokenize: intlTokenizer("zh-Hans"),
  lookup,
  features: { tones: null, strokes: null, romanization: null, decomposition: null },
});
