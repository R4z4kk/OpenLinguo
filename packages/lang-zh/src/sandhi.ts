import { err, ok, type InvalidReading, type Result } from "@openlinguo/core";
import { formatNumbered, parseNumbered, type ReadingToken, type Tone } from "./pinyin.ts";

export type ReadingWord = { readonly text: string; readonly reading: string };

export type SandhiError =
  | InvalidReading
  | { readonly kind: "unaligned-reading"; readonly text: string; readonly reading: string };

type Unit = {
  readonly word: number;
  readonly char: string | null;
  readonly token: ReadingToken;
  spoken: Tone | null;
};

const DIGITS = new Set(["〇", "零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]);
const DATE_SUFFIXES = new Set(["月", "号"]);

const syllable = (unit: Unit | null, letters: string, tone: Tone): boolean =>
  unit?.token.kind === "syllable" &&
  unit.token.tone === tone &&
  unit.token.letters.toLowerCase() === letters;

const writtenTone = (unit: Unit | null): Tone | null =>
  unit?.token.kind === "syllable" ? unit.token.tone : null;

const yiTone = (prev: Unit | null, unit: Unit, next: Unit | null): Tone => {
  const nextTone = writtenTone(next);
  if (next === null || nextTone === null || prev?.char === "第") return 1;
  if (prev?.word === unit.word && next.word !== unit.word) return 1;
  if (DIGITS.has(prev?.char ?? "") || DIGITS.has(next.char ?? "")) return 1;
  if (DATE_SUFFIXES.has(next.char ?? "")) return 1;
  if (prev?.char != null && prev.char === next.char) return 5;
  return nextTone === 4 || nextTone === 5 ? 2 : 4;
};

const applyYiBu = (units: readonly Unit[]): void => {
  units.forEach((unit, index) => {
    const prev = units[index - 1] ?? null;
    const next = units[index + 1] ?? null;
    if (unit.char === "不" && syllable(unit, "bu", 4) && writtenTone(next) === 4) unit.spoken = 2;
    if (unit.char === "一" && syllable(unit, "yi", 1)) unit.spoken = yiTone(prev, unit, next);
  });
};

const applyThirdTone = (words: readonly (readonly Unit[])[]): void => {
  for (const units of words) {
    units.forEach((unit, index) => {
      if (unit.spoken === 3 && units[index + 1]?.spoken === 3) unit.spoken = 2;
    });
  }
  const syllableCount = (units: readonly Unit[]): number =>
    units.filter((unit) => unit.spoken !== null).length;
  for (let index = words.length - 2; index >= 0; index--) {
    const left = words[index] ?? [];
    const right = words[index + 1] ?? [];
    const last = left.at(-1);
    if (last?.spoken !== 3 || right[0]?.spoken !== 3) continue;
    if (syllableCount(left) === 1 || syllableCount(right) === 1) last.spoken = 2;
  }
};

/**
 * Spoken tones for a segmented sentence, as numbered readings per word.
 * Approximation: three-syllable words are not split, and a third tone before a neutral
 * tone is left unchanged because the dictionary does not store the underlying tone.
 */
export const applySandhi = (
  words: readonly ReadingWord[],
): Result<readonly string[], SandhiError> => {
  const grouped: Unit[][] = [];
  for (const [word, { text, reading }] of words.entries()) {
    const tokens = parseNumbered(reading);
    if (!tokens.ok) return tokens;
    const chars = Array.from(text);
    const aligned = chars.length === tokens.value.length;
    if (!aligned && /[一不]/u.test(text)) return err({ kind: "unaligned-reading", text, reading });
    grouped.push(
      tokens.value.map((token, index) => ({
        word,
        char: aligned ? (chars[index] ?? null) : null,
        token,
        spoken: token.kind === "syllable" ? token.tone : null,
      })),
    );
  }
  applyYiBu(grouped.flat());
  applyThirdTone(grouped);
  return ok(
    grouped.map((units) =>
      formatNumbered(
        units.map(({ token, spoken }) =>
          token.kind === "syllable" && spoken !== null ? { ...token, tone: spoken } : token,
        ),
      ),
    ),
  );
};
