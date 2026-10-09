import type { DictEntry, DictionaryLookup, Token } from "./language-pack.ts";
import { ok } from "./result.ts";

export const inMemoryDictionary = (entries: readonly DictEntry[]): DictionaryLookup => {
  const index = new Map<string, DictEntry[]>();
  for (const entry of entries) {
    for (const form of new Set([entry.headword, ...entry.variants])) {
      const bucket = index.get(form);
      if (bucket) {
        bucket.push(entry);
      } else {
        index.set(form, [entry]);
      }
    }
  }
  return (term) => Promise.resolve(ok(index.get(term) ?? []));
};

export const intlTokenizer = (locale: string): ((text: string) => readonly Token[]) => {
  const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
  return (text) =>
    Array.from(segmenter.segment(text), ({ segment, index, isWordLike }) => ({
      text: segment,
      start: index,
      end: index + segment.length,
      isWord: isWordLike === true,
    }));
};
