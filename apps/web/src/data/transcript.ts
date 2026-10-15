import { err, ok, type LanguagePack, type LookupError, type Result } from "@openlinguo/core";
import { alignChars, readingChars, type SpokenChar } from "@openlinguo/lang-zh";
import { Converter } from "opencc-js/t2cn";

/** A character with the syllables it may be read as, and the reading shown for it (numbered pinyin). */
export type ReadChar = SpokenChar & { readonly reading: string | null };

const HAN = /\p{Script=Han}/u;
const DIGITS = "零一二三四五六七八九";

/**
 * Whisper writes Mandarin in traditional characters more often than not (ADR 0007). `tw`: on the
 * benchmark's transcripts it scored as well as `t` and `hk`, or better.
 */
export const toSimplified: (text: string) => string = Converter({ from: "tw", to: "cn" });

const syllablesOf = async (
  pack: LanguagePack,
  word: string,
): Promise<
  Result<{ readonly sets: Set<string>[]; readonly shown: (string | null)[] }, LookupError>
> => {
  const length = Array.from(word).length;
  const entries = await pack.lookup(word);
  if (!entries.ok) return entries;
  const sets = Array.from({ length }, () => new Set<string>());
  let shown: (string | null)[] = Array.from({ length }, () => null);
  for (const { reading } of entries.value) {
    const chars = reading === null ? null : readingChars(word, reading);
    if (chars === null || reading === null) continue;
    for (const [position, { syllables }] of chars.entries()) {
      for (const syllable of syllables) sets[position]?.add(syllable);
    }
    if (shown.every((value) => value === null)) shown = reading.split(" ");
  }
  return ok({ sets, shown });
};

/**
 * The characters of `text`, each with every syllable the dictionary reads it as in the word the
 * segmenter puts it in (alone when that word has no reading), and the word's first reading to
 * show. Digits are read as characters; punctuation is dropped; a run of other letters is one item
 * that matches nothing.
 */
export const readText = async (
  pack: LanguagePack,
  text: string,
): Promise<Result<readonly ReadChar[], LookupError>> => {
  const normalized = text.replace(/[0-9]/gu, (digit) => DIGITS[Number(digit)] ?? digit);
  const chars: ReadChar[] = [];
  for (const token of pack.tokenize(normalized)) {
    if (!token.isWord) continue;
    if (!HAN.test(token.text)) {
      chars.push({ char: token.text, syllables: new Set(), reading: null });
      continue;
    }
    const word = await syllablesOf(pack, token.text);
    if (!word.ok) return err(word.error);
    for (const [position, char] of Array.from(token.text).entries()) {
      let syllables = word.value.sets[position] ?? new Set<string>();
      let reading = word.value.shown[position] ?? null;
      if (syllables.size === 0) {
        const alone = await syllablesOf(pack, char);
        if (!alone.ok) return err(alone.error);
        syllables = alone.value.sets[0] ?? syllables;
        reading = alone.value.shown[0] ?? null;
      }
      chars.push({ char, syllables, reading });
    }
  }
  return ok(chars);
};

/** The characters of a word and its reading (numbered pinyin), or `null` when they do not pair up. */
export const readWord = (headword: string, reading: string): readonly ReadChar[] | null => {
  const chars = readingChars(headword, reading);
  const syllables = reading.split(" ");
  return chars?.map((char, index) => ({ ...char, reading: syllables[index] ?? null })) ?? null;
};

export type SpeechCheck = {
  readonly expected: readonly ReadChar[];
  readonly heard: readonly ReadChar[];
};

/** What was heard, in simplified characters, read against the expected characters. */
export const checkTranscript = async (
  pack: LanguagePack,
  expected: readonly ReadChar[],
  transcript: string,
): Promise<Result<SpeechCheck, LookupError>> => {
  const heard = await readText(pack, toSimplified(transcript));
  return heard.ok ? ok({ expected, heard: heard.value }) : heard;
};

const hanChars = (text: string): SpokenChar[] =>
  Array.from(text.matchAll(/\p{Script=Han}/gu), ([char]) => ({ char, syllables: new Set() }));

/** The share of the expected characters heard as such, in simplified characters (0 to 1). */
export const sameShare = (expected: string, transcript: string): number => {
  const wanted = hanChars(expected);
  if (wanted.length === 0) return 0;
  const same = alignChars(wanted, hanChars(toSimplified(transcript))).filter(
    ({ kind }) => kind === "same",
  );
  return same.length / wanted.length;
};
