import { readdir, readFile } from "node:fs/promises";
import { dataDir } from "../manifest.ts";

type CedictRow = readonly [simplified: string, traditional: string, reading: string];

/** Toneless syllables of every one-character CC-CEDICT headword, simplified and traditional forms. */
export type CharSyllables = ReadonlyMap<string, ReadonlySet<string>>;

const HAN = /\p{Script=Han}/u;
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

export const charSyllables = (rows: readonly CedictRow[]): CharSyllables => {
  const map = new Map<string, Set<string>>();
  for (const [simplified, traditional, reading] of rows) {
    if (Array.from(simplified).length !== 1 || reading.includes(" ")) continue;
    for (const char of new Set([simplified, traditional])) {
      const syllables = map.get(char) ?? new Set<string>();
      syllables.add(toneless(reading));
      map.set(char, syllables);
    }
  }
  return map;
};

export const loadCharSyllables = async (): Promise<CharSyllables> => {
  const dir = new URL("cc-cedict/", dataDir);
  const names = (await readdir(dir)).filter((name) => name.startsWith("entries-"));
  const shards = await Promise.all(names.map((name) => readFile(new URL(name, dir), "utf8")));
  return charSyllables(shards.flatMap((shard) => JSON.parse(shard) as CedictRow[]));
};

const hanOf = (text: string): string[] =>
  Array.from(text)
    .map((char) => (/[0-9]/u.test(char) ? (DIGITS[Number(char)] ?? char) : char))
    .filter((char) => HAN.test(char));

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
  const heard = hanOf(transcript);
  return (
    sameSyllables(chars, heard, syllables.map(toneless)) ||
    sameSyllables(chars, heard, syllables.filter((syllable) => syllable !== "r5").map(toneless))
  );
};
