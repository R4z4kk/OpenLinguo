import {
  err,
  ok,
  type ImeCandidate,
  type ImeFeature,
  type LookupError,
  type Result,
} from "@openlinguo/core";
import { parseNumbered, type Tone } from "./pinyin.ts";
import { FINALS, INITIALS, INTERJECTIONS, spell } from "./pinyin-chart.ts";
import { searchKey } from "./pinyin-search.ts";

/** A dictionary word the input method can offer. */
export type ImeWord = {
  readonly headword: string;
  /** Numbered reading (`dian4 hua4`); a capitalized one is a proper noun's. */
  readonly reading: string;
  /** Zipf frequency of the headword (wordfreq), `null` when unknown. */
  readonly frequency: number | null;
};

/** Words whose toneless reading is `key` (`searchKey`), from the dictionary's pinyin index. */
export type ImeWordsOf = (key: string) => Promise<Result<readonly ImeWord[], LookupError>>;

/** A syllable read from the input: letters as typed (ü as v), the tone typed after it, if any. */
export type TypedSyllable = {
  readonly letters: string;
  readonly tone: Tone | null;
  /** Index of the input after the syllable, its tone digit and apostrophes. */
  readonly end: number;
};

const COLUMNS: readonly (string | null)[] = [null, ...INITIALS.map(({ letters }) => letters)];

/** The chart's syllables as typed, ü as v; ê has no key. */
const SYLLABLES: ReadonlySet<string> = new Set(
  [
    ...FINALS.flatMap((pinyinFinal) =>
      COLUMNS.flatMap((initial) => spell(initial, pinyinFinal) ?? []),
    ),
    ...INTERJECTIONS,
  ]
    .filter((syllable) => /^[a-zü]+$/u.test(syllable))
    .map((syllable) => syllable.replace(/ü/gu, "v")),
);
const MAX_SYLLABLE_LENGTH = Math.max(...[...SYLLABLES].map((syllable) => syllable.length));
/** CC-CEDICT writes erhua as a syllable of its own after another one (哪儿 na3 r5). */
const ERHUA = "r";
const TONES: ReadonlyMap<string, Tone> = new Map([
  ["1", 1],
  ["2", 2],
  ["3", 3],
  ["4", 4],
  ["5", 5],
]);
const SEPARATOR = "'";

/** Lowercase, ü as v, ’ as ': one code unit for one, so indexes stay the input's. */
const typedText = (input: string): string =>
  input
    .replace(/[A-Z]/gu, (letter) => letter.toLowerCase())
    .replace(/[üÜ]/gu, "v")
    .replace(/’/gu, SEPARATOR);

const afterSeparators = (text: string, at: number): number => {
  let next = at;
  while (text.charAt(next) === SEPARATOR) next++;
  return next;
};

/** Syllables starting at `at`, longest first. */
const syllablesAt = (text: string, at: number, first: boolean): TypedSyllable[] => {
  const letters = /^[a-z]+/u.exec(text.slice(at, at + MAX_SYLLABLE_LENGTH))?.[0] ?? "";
  const found: TypedSyllable[] = [];
  for (let length = letters.length; length > 0; length--) {
    const syllable = letters.slice(0, length);
    if (!SYLLABLES.has(syllable) && (first || syllable !== ERHUA)) continue;
    const tone = TONES.get(text.charAt(at + length)) ?? null;
    const end = afterSeparators(text, at + length + (tone === null ? 0 : 1));
    found.push({ letters: syllable, tone, end });
  }
  return found;
};

/** The syllables on a path from `start` to `end`, the furthest index a path reaches, by index. */
type Lattice = {
  readonly start: number;
  readonly end: number;
  readonly from: ReadonlyMap<number, readonly TypedSyllable[]>;
};

const latticeOf = (text: string): Lattice | null => {
  const start = afterSeparators(text, 0);
  const next = new Map<number, readonly TypedSyllable[]>();
  const reached = new Set([start]);
  let end = start;
  for (let at = start; at < text.length; at++) {
    if (!reached.has(at)) continue;
    const found = syllablesAt(text, at, at === start);
    next.set(at, found);
    for (const syllable of found) {
      reached.add(syllable.end);
      end = Math.max(end, syllable.end);
    }
  }
  if (end === start) return null;
  const onPath = new Set([end]);
  const from = new Map<number, readonly TypedSyllable[]>();
  for (let at = end - 1; at >= start; at--) {
    const kept = (next.get(at) ?? []).filter((syllable) => onPath.has(syllable.end));
    if (kept.length === 0) continue;
    onPath.add(at);
    from.set(at, kept);
  }
  return { start, end, from };
};

/**
 * Every way to read the start of the input as syllables, up to the furthest index one reaches:
 * `xian` is xian or xi'an, an apostrophe forces a split, `v` is ü, a digit 1–5 after a syllable
 * is its tone (5 neutral). Empty when the input starts with no syllable.
 */
export const splitPinyin = (input: string): readonly (readonly TypedSyllable[])[] => {
  const lattice = latticeOf(typedText(input));
  if (lattice === null) return [];
  const pathsFrom = (at: number): TypedSyllable[][] =>
    at === lattice.end
      ? [[]]
      : (lattice.from.get(at) ?? []).flatMap((syllable) =>
          pathsFrom(syllable.end).map((rest) => [syllable, ...rest]),
        );
  return pathsFrom(lattice.start);
};

/** Index of the input after the word, when its syllables follow a path and carry the tones typed. */
const endOf = (lattice: Lattice, reading: string): number | null => {
  const tokens = parseNumbered(reading);
  if (!tokens.ok) return null;
  let at = lattice.start;
  for (const token of tokens.value) {
    const letters = searchKey(token.kind === "syllable" ? token.letters : token.text);
    // Punctuation inside a name (马克·吐温) is not typed.
    if (letters === "") continue;
    const tone = token.kind === "syllable" ? token.tone : null;
    const syllable = lattice.from.get(at)?.find((typed) => typed.letters === letters) ?? null;
    if (syllable === null || (syllable.tone !== null && syllable.tone !== tone)) return null;
    at = syllable.end;
  }
  return at;
};

type Offer = { readonly word: ImeWord; readonly consumed: number };

/** Descending, `null` last. */
const byFrequency = (a: number | null, b: number | null): number =>
  a === null || b === null ? Number(a === null) - Number(b === null) : b - a;

const isProperNoun = (word: ImeWord): boolean => /^[A-Z]/u.test(word.reading);

/** Covering more of the input first, then by frequency; common words before proper nouns. */
const compareOffers = (a: Offer, b: Offer): number =>
  b.consumed - a.consumed ||
  byFrequency(a.word.frequency, b.word.frequency) ||
  Number(isProperNoun(a.word)) - Number(isProperNoun(b.word)) ||
  (a.word.headword < b.word.headword ? -1 : a.word.headword > b.word.headword ? 1 : 0);

/** Pinyin input method over dictionary words: candidates for the syllables the input starts with. */
export const createIme = (wordsOf: ImeWordsOf): ImeFeature => ({
  candidates: async (input) => {
    const text = typedText(input);
    const lattice = latticeOf(text);
    if (lattice === null) return err({ kind: "unknown-input", input });
    const ends = [...lattice.from.keys(), lattice.end].filter((at) => at > lattice.start);
    const looked = await Promise.all(
      ends.map(async (at) => {
        const key = text.slice(lattice.start, at).replace(/[^a-z]/gu, "");
        return { at, words: await wordsOf(key) };
      }),
    );
    const offers: Offer[] = [];
    for (const { at, words } of looked) {
      if (!words.ok) return words;
      for (const word of words.value) {
        if (endOf(lattice, word.reading) === at) offers.push({ word, consumed: at });
      }
    }
    const seen = new Set<string>();
    const candidates: ImeCandidate[] = [];
    for (const { word, consumed } of offers.sort(compareOffers)) {
      if (seen.has(word.headword)) continue;
      seen.add(word.headword);
      candidates.push({ text: word.headword, consumed });
    }
    const best = candidates[0] ?? null;
    return best === null
      ? err({ kind: "no-match", input })
      : ok([best, ...candidates.slice(1)] as const);
  },
});
