import { intlTokenizer, type DictionaryLookup, type LanguagePack } from "@openlinguo/core";

export const createEnPack = (lookup: DictionaryLookup): LanguagePack => ({
  id: "en",
  proficiency: "cefr",
  tokenize: intlTokenizer("en"),
  lookup,
  features: { tones: null, strokes: null, romanization: null, decomposition: null },
});
