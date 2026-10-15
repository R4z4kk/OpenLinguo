import { readdir, readFile } from "node:fs/promises";
import { dataDir } from "../manifest.ts";

type CedictRow = readonly [simplified: string, traditional: string, reading: string];

/** Toneless syllables of every character in CC-CEDICT headwords, simplified and traditional forms. */
export type CharSyllables = ReadonlyMap<string, ReadonlySet<string>>;

const DIGITS = "零一二三四五六七八九";

/** "lu:4" and "lü4" give "lü"; the erhua suffix "r5" counts as 儿's own "er". */
const toneless = (syllable: string): string => {
  const letters = syllable
    .toLowerCase()
    .replace(/[1-5]$/u, "")
    .replace("u:", "ü")
    .replace("v", "ü");
  return letters === "r" ? "er" : letters;
};

/**
 * Every syllable a character takes in CC-CEDICT, words included: a one-character entry can miss the reading
 * a word uses (钥 is only yue4 alone, yao4 in 钥匙).
 */
export const charSyllables = (rows: readonly CedictRow[]): CharSyllables => {
  const map = new Map<string, Set<string>>();
  for (const [simplified, traditional, reading] of rows) {
    const syllables = reading.split(" ");
    for (const form of new Set([simplified, traditional])) {
      const chars = Array.from(form);
      if (chars.length !== syllables.length) continue;
      chars.forEach((char, index) => {
        const known = map.get(char) ?? new Set<string>();
        known.add(toneless(syllables[index] ?? ""));
        map.set(char, known);
      });
    }
  }
  return map;
};

/** Every tone (1–5) a character takes in CC-CEDICT, words included. */
export type CharTones = ReadonlyMap<string, ReadonlySet<string>>;

export const charTones = (rows: readonly CedictRow[]): CharTones => {
  const map = new Map<string, Set<string>>();
  for (const [simplified, traditional, reading] of rows) {
    const syllables = reading.split(" ");
    for (const form of new Set([simplified, traditional])) {
      const chars = Array.from(form);
      if (chars.length !== syllables.length) continue;
      chars.forEach((char, index) => {
        const known = map.get(char) ?? new Set<string>();
        known.add(/[1-5]$/u.exec(syllables[index] ?? "")?.[0] ?? "5");
        map.set(char, known);
      });
    }
  }
  return map;
};

export const loadCedictChars = async (): Promise<{
  readonly syllables: CharSyllables;
  readonly tones: CharTones;
}> => {
  const dir = new URL("cc-cedict/", dataDir);
  const names = (await readdir(dir)).filter((name) => name.startsWith("entries-"));
  const shards = await Promise.all(names.map((name) => readFile(new URL(name, dir), "utf8")));
  const rows = shards.flatMap((shard) => JSON.parse(shard) as CedictRow[]);
  return { syllables: charSyllables(rows), tones: charTones(rows) };
};

/** One token per Chinese character or digit; a run of other letters ("a吗", "town") is one word that never matches. */
const tokensOf = (text: string): string[] =>
  (text.match(/\p{Script=Han}|[0-9]|[^\p{Script=Han}\P{L}]+/gu) ?? []).map((token) =>
    /^[0-9]$/u.test(token) ? (DIGITS[Number(token)] ?? token) : token,
  );

const sameSyllables = (
  chars: CharSyllables,
  heard: readonly string[],
  expected: readonly string[],
): boolean =>
  heard.length === expected.length &&
  heard.every((char, index) => chars.get(char)?.has(expected[index] ?? "") === true);

/**
 * True when the transcript has as many characters as the target has syllables and each character can be read
 * as the target syllable, tones aside: homophones and traditional forms pass, an added or missing word fails.
 * Recognizers often write erhua without its 儿 (一点儿 as 一点), so the "r5" suffix may be missing.
 */
export const transcriptMatches = (
  chars: CharSyllables,
  reading: string,
  transcript: string,
): boolean => {
  const syllables = reading.split(" ");
  const heard = tokensOf(transcript);
  return (
    sameSyllables(chars, heard, syllables.map(toneless)) ||
    sameSyllables(chars, heard, syllables.filter((syllable) => syllable !== "r5").map(toneless))
  );
};

/**
 * True when the one character heard for an isolated syllable can carry its tone. Alone, a recognizer picks the
 * character from the sound, tone included, so another tone is a hint that the recording missed it.
 */
export const heardToneMatches = (
  tones: CharTones,
  reading: string,
  transcript: string,
): boolean => {
  const [heard = "", ...rest] = tokensOf(transcript);
  const expected = /[1-5]$/u.exec(reading)?.[0] ?? "5";
  return rest.length === 0 && (expected === "5" || tones.get(heard)?.has(expected) === true);
};
