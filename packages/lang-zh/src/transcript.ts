import { parseNumbered } from "./pinyin.ts";

/** One character and the syllables it may be read as, tones aside. */
export type SpokenChar = { readonly char: string; readonly syllables: ReadonlySet<string> };

export type CharMatch<T extends SpokenChar = SpokenChar> =
  | {
      /** `homophone`: another character read as the same syllable, tones aside. */
      readonly kind: "same" | "homophone" | "different";
      readonly expected: T;
      readonly heard: T;
    }
  | { readonly kind: "missing"; readonly expected: T }
  | { readonly kind: "extra"; readonly heard: T };

/** The characters of a word paired with the syllables of a numbered reading; `null` when they do not pair up. */
export const readingChars = (word: string, reading: string): readonly SpokenChar[] | null => {
  const chars = Array.from(word);
  const tokens = parseNumbered(reading);
  if (!tokens.ok || tokens.value.length !== chars.length) return null;
  const syllables: string[] = [];
  for (const token of tokens.value) {
    if (token.kind !== "syllable") return null;
    // The erhua suffix "r5" is 儿's own reading.
    syllables.push(token.letters.toLowerCase() === "r" ? "er" : token.letters.toLowerCase());
  }
  return chars.map((char, index) => ({ char, syllables: new Set([syllables[index] ?? ""]) }));
};

const SAME = 0;
const HOMOPHONE = 1;
const DIFFERENT = 3;
const GAP = 2;

const substitution = (
  expected: SpokenChar,
  heard: SpokenChar,
): "same" | "homophone" | "different" => {
  if (expected.char === heard.char) return "same";
  for (const syllable of expected.syllables) if (heard.syllables.has(syllable)) return "homophone";
  return "different";
};

const COST = { same: SAME, homophone: HOMOPHONE, different: DIFFERENT } as const;

/**
 * Aligns what was heard with what was expected, character by character (edit distance): an exact
 * character costs nothing, a homophone less than another character, so homophones line up.
 */
export const alignChars = <T extends SpokenChar>(
  expected: readonly T[],
  heard: readonly T[],
): readonly CharMatch<T>[] => {
  const rows = expected.length + 1;
  const columns = heard.length + 1;
  const cost = new Float64Array(rows * columns);
  for (let i = 0; i < rows; i++) cost[i * columns] = i * GAP;
  for (let j = 0; j < columns; j++) cost[j] = j * GAP;
  const at = (i: number, j: number): number => cost[i * columns + j] ?? 0;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < columns; j++) {
      const wanted = expected[i - 1];
      const said = heard[j - 1];
      const pair = wanted && said ? COST[substitution(wanted, said)] : DIFFERENT;
      cost[i * columns + j] = Math.min(
        at(i - 1, j - 1) + pair,
        at(i - 1, j) + GAP,
        at(i, j - 1) + GAP,
      );
    }
  }
  const matches: CharMatch<T>[] = [];
  let i = expected.length;
  let j = heard.length;
  while (i > 0 || j > 0) {
    const wanted = expected[i - 1] ?? null;
    const said = heard[j - 1] ?? null;
    if (wanted !== null && said !== null) {
      const kind = substitution(wanted, said);
      if (at(i, j) === at(i - 1, j - 1) + COST[kind]) {
        matches.push({ kind, expected: wanted, heard: said });
        i -= 1;
        j -= 1;
        continue;
      }
    }
    if (wanted !== null && at(i, j) === at(i - 1, j) + GAP) {
      matches.push({ kind: "missing", expected: wanted });
      i -= 1;
    } else if (said !== null) {
      matches.push({ kind: "extra", heard: said });
      j -= 1;
    } else {
      break;
    }
  }
  return matches.reverse();
};
