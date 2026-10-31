import {
  ok,
  type AnnotatedToken,
  type DictEntry,
  type DictionaryLookup,
  type ReadingChoices,
  type TextReadingFeature,
  type Token,
} from "@openlinguo/core";
import { applySandhi, type ReadingWord } from "./sandhi.ts";

const HAN = /\p{Script=Han}/u;

/** Ascending, `null` last. */
const byLevel = (a: number | null, b: number | null): number =>
  a === null || b === null ? Number(a === null) - Number(b === null) : a - b;

const isProperNoun = (reading: string): boolean => /^[A-Z]/u.test(reading);

/**
 * By level in the pack's referential, then common words before proper nouns; the dictionary's
 * order decides the rest (the frequency is the word's, the same for every reading).
 */
const readingsOf = (entries: readonly DictEntry[]): readonly string[] => {
  const readings = entries.flatMap(({ reading, level }) =>
    reading === null ? [] : [{ reading, level }],
  );
  readings.sort(
    (a, b) =>
      byLevel(a.level, b.level) ||
      Number(isProperNoun(a.reading)) - Number(isProperNoun(b.reading)),
  );
  return Array.from(new Set(readings.map(({ reading }) => reading)));
};

const readingOf = (token: AnnotatedToken, chosen: ReadingChoices): string | null => {
  const picked = chosen[token.start];
  return picked != null && token.readings.includes(picked) ? picked : (token.readings[0] ?? null);
};

type Reading = { readonly index: number; readonly word: ReadingWord };

/** Lookups in flight at once: thousands queued together make IndexedDB slower per lookup (WebKit). */
const LOOKUPS_IN_FLIGHT = 100;

export const createTextReading = (
  lookup: DictionaryLookup,
  tokenize: (text: string, extra?: ReadonlySet<string>) => readonly Token[],
): TextReadingFeature => ({
  annotate: async (text, extraHeadwords) => {
    const tokens = tokenize(text, extraHeadwords);
    const forms = Array.from(new Set(tokens.map((token) => token.text))).filter((form) =>
      HAN.test(form),
    );
    const readings = new Map<string, readonly string[]>();
    for (let index = 0; index < forms.length; index += LOOKUPS_IN_FLIGHT) {
      const wave = await Promise.all(
        forms
          .slice(index, index + LOOKUPS_IN_FLIGHT)
          .map(async (form) => [form, await lookup(form)] as const),
      );
      for (const [form, entries] of wave) {
        if (!entries.ok) return entries;
        readings.set(form, readingsOf(entries.value));
      }
    }
    return ok(
      tokens.map(({ text: word, start, end }) => {
        const wordReadings = readings.get(word) ?? [];
        return {
          text: word,
          start,
          end,
          isWord: HAN.test(word),
          readings: wordReadings,
          ambiguous: wordReadings.length > 1,
        };
      }),
    );
  },
  pinyin: (tokens, chosen = {}) => {
    const spoken: (string | null)[] = tokens.map(() => null);
    const runs: Reading[][] = [[]];
    for (const [index, token] of tokens.entries()) {
      const reading = readingOf(token, chosen);
      if (reading === null) runs.push([]);
      else runs.at(-1)?.push({ index, word: { text: token.text, reading } });
    }
    for (const run of runs) {
      const sandhi = applySandhi(run.map(({ word }) => word));
      if (!sandhi.ok) return sandhi;
      for (const [position, { index }] of run.entries())
        spoken[index] = sandhi.value[position] ?? null;
    }
    return ok(spoken);
  },
});
