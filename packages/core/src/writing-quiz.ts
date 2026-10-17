import type { StrokeData } from "./language-pack.ts";
import { err, ok, type Result } from "./result.ts";
import type { Grade } from "./srs.ts";
import { strokeMatches, type Point, type StrokeMatch } from "./stroke-matcher.ts";

/** Misses on a stroke before its outline is shown as a hint (ADR 0011). */
export const HINT_AFTER_MISSES = 3;

type Progress = {
  readonly characters: readonly StrokeData[];
  /** Per character, the misses on each of its strokes. */
  readonly misses: readonly (readonly number[])[];
};

type Writing = Progress & {
  readonly finished: false;
  readonly character: number;
  readonly stroke: number;
};

type Written = Progress & { readonly finished: true };

/** A writing card's quiz: the strokes of each character, in order. */
export type WritingQuiz = Writing | Written;

export type WritingQuizError =
  | { readonly kind: "no-character"; readonly character: number }
  | { readonly kind: "no-stroke"; readonly character: number; readonly stroke: number };

export type WritingStep = {
  readonly quiz: WritingQuiz;
  /** `null` for a tap, fewer than two distinct points: not judged. */
  readonly match: StrokeMatch | null;
};

export const startWritingQuiz = (
  characters: readonly StrokeData[],
): Result<WritingQuiz, WritingQuizError> => {
  if (characters.length === 0) return err({ kind: "no-character", character: 0 });
  const blank = characters.findIndex(({ medians }) => medians.length === 0);
  if (blank !== -1) return err({ kind: "no-stroke", character: blank, stroke: 0 });
  const misses = characters.map(({ medians }) => medians.map(() => 0));
  return ok({ finished: false, characters, misses, character: 0, stroke: 0 });
};

/** Whether the current stroke's outline is shown: after three misses on it. */
export const showsHint = (quiz: Writing): boolean =>
  (quiz.misses[quiz.character]?.[quiz.stroke] ?? 0) >= HINT_AFTER_MISSES;

const isTap = (drawn: readonly Point[]): boolean => {
  const first = drawn.at(0) ?? null;
  return first === null || drawn.every(([x, y]) => x === first[0] && y === first[1]);
};

/**
 * Judges a stroke drawn for the current stroke. A match moves on to the next stroke, then to the
 * next character; anything else, a stroke drawn backwards included, is a miss on this stroke.
 */
export const drawStroke = (
  quiz: Writing,
  drawn: readonly Point[],
): Result<WritingStep, WritingQuizError> => {
  const { characters, character, stroke } = quiz;
  const data = characters[character] ?? null;
  if (data === null) return err({ kind: "no-character", character });
  if (isTap(drawn)) return ok({ quiz, match: null });
  const judged = strokeMatches(drawn, data, stroke);
  if (!judged.ok) return err({ kind: "no-stroke", character, stroke });

  const match = judged.value;
  if (match !== "match") {
    const misses = quiz.misses.map((counts, at) =>
      at === character
        ? counts.map((count, index) => (index === stroke ? count + 1 : count))
        : counts,
    );
    return ok({ quiz: { ...quiz, misses }, match });
  }
  if (stroke + 1 < data.medians.length) return ok({ quiz: { ...quiz, stroke: stroke + 1 }, match });
  if (character + 1 < characters.length) {
    return ok({ quiz: { ...quiz, character: character + 1, stroke: 0 }, match });
  }
  return ok({ quiz: { finished: true, characters, misses: quiz.misses }, match });
};

/** No miss is good, misses without a hint hard, any hint again; never easy, as with the tone card. */
export const gradeWriting = (quiz: Written): Grade => {
  const misses = quiz.misses.flat();
  if (misses.some((count) => count >= HINT_AFTER_MISSES)) return "again";
  return misses.some((count) => count > 0) ? "hard" : "good";
};
