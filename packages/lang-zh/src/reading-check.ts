import {
  err,
  ok,
  type DictEntry,
  type DictionaryLookup,
  type LookupError,
  type PromptPack,
  type ReadingMismatch,
  type Result,
  type Token,
} from "@openlinguo/core";
import { formatNumbered, joinedToNumbered, parseNumbered } from "./pinyin.ts";

const HAN = /\p{Script=Han}/u;
const NOT_PINYIN = /[^\p{L}\p{M}\s'’-]+/gu;

/** Accepted beside the dictionary's tone (tone sandhi). */
const SANDHI: Readonly<Record<string, readonly string[]>> = {
  一: ["yi2", "yi4", "yi5"],
  不: ["bu2", "bu5"],
};

type HanChar = {
  readonly char: string;
  readonly start: number;
  readonly word: string;
  readonly offset: number;
};

/** Lowercase numbered syllables, `null` unless every token is one. */
const syllablesOf = (reading: string | null): readonly string[] | null => {
  const tokens = reading === null ? null : parseNumbered(reading);
  if (tokens === null || !tokens.ok) return null;
  const syllables: string[] = [];
  for (const token of tokens.value) {
    if (token.kind !== "syllable") return null;
    syllables.push(formatNumbered([token]).toLowerCase());
  }
  return syllables;
};

const lettersOf = (syllable: string): string => syllable.slice(0, -1);

const readingsAt = (
  entries: readonly DictEntry[],
  length: number,
  offset: number,
): ReadonlySet<string> =>
  new Set(
    entries.flatMap(({ reading }) => {
      const syllables = syllablesOf(reading);
      const syllable = syllables?.length === length ? (syllables[offset] ?? null) : null;
      return syllable === null ? [] : [syllable];
    }),
  );

/** In a word, its syllable there, or the character's own tone on the same letters. */
const allowedAt = (
  charReadings: ReadonlySet<string>,
  wordReadings: ReadonlySet<string>,
): ReadonlySet<string> => {
  if (wordReadings.size === 0) return charReadings;
  const letters = new Set(Array.from(wordReadings, lettersOf));
  return new Set([
    ...wordReadings,
    ...Array.from(charReadings).filter((syllable) => letters.has(lettersOf(syllable))),
  ]);
};

const hanChars = (tokens: readonly Token[]): readonly HanChar[] => {
  const chars: HanChar[] = [];
  for (const token of tokens) {
    let start = token.start;
    for (const [offset, char] of Array.from(token.text).entries()) {
      if (HAN.test(char)) chars.push({ char, start, word: token.text, offset });
      start += char.length;
    }
  }
  return chars;
};

const entriesOf = async (
  lookup: DictionaryLookup,
  forms: readonly string[],
): Promise<Result<ReadonlyMap<string, readonly DictEntry[]>, LookupError>> => {
  const unique = Array.from(new Set(forms));
  const results = await Promise.all(unique.map((form) => lookup(form)));
  const entries = new Map<string, readonly DictEntry[]>();
  for (const [index, result] of results.entries()) {
    if (!result.ok) return result;
    entries.set(unique[index] ?? "", result.value);
  }
  return ok(entries);
};

/**
 * Pairs each Chinese character with one syllable of the reading and flags those the dictionary
 * does not give there. Tone sandhi passes: 一 and 不, and a third tone written as a second one
 * before another third tone.
 */
export const createReadingCheck =
  (
    lookup: DictionaryLookup,
    tokenize: (text: string) => readonly Token[],
  ): PromptPack["checkReading"] =>
  async (text, reading) => {
    const chars = hanChars(tokenize(text));
    if (chars.length === 0) return ok([]);
    const split = joinedToNumbered(reading.replace(NOT_PINYIN, " "), chars.length);
    const written = split.ok ? syllablesOf(split.value) : null;
    if (written?.length !== chars.length) return err({ kind: "invalid-reading", reading });
    const entries = await entriesOf(
      lookup,
      chars.flatMap(({ char, word }) => [char, word]),
    );
    if (!entries.ok) return entries;
    const allowed = chars.map(({ char, word, offset }) =>
      allowedAt(
        readingsAt(entries.value.get(char) ?? [], 1, 0),
        readingsAt(entries.value.get(word) ?? [], Array.from(word).length, offset),
      ),
    );
    const accepts = (index: number, char: string): boolean => {
      const syllable = written[index] ?? "";
      const here = allowed[index] ?? new Set<string>();
      if (here.has(syllable) || SANDHI[char]?.includes(syllable) === true) return true;
      const next = written[index + 1] ?? null;
      return (
        syllable.endsWith("2") &&
        here.has(`${lettersOf(syllable)}3`) &&
        next !== null &&
        allowed[index + 1]?.has(`${lettersOf(next)}3`) === true
      );
    };
    const mismatches: ReadingMismatch[] = [];
    for (const [index, { char, start }] of chars.entries()) {
      if (accepts(index, char)) continue;
      mismatches.push({
        start,
        end: start + char.length,
        written: written[index] ?? "",
        readings: Array.from(allowed[index] ?? []).sort(),
      });
    }
    return ok(mismatches);
  };
