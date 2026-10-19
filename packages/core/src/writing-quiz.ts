import type { StrokeData } from "./language-pack.ts";
import { err, ok, type Result } from "./result.ts";
import type { Grade } from "./srs.ts";
import { strokeMatches, type StrokeMatch, type StrokePoint } from "./stroke-matcher.ts";

/** Misses on a stroke before its outline is shown as a hint (ADR 0011). */
export const HINT_AFTER_MISSES = 3;

type Progress = {
  readonly characters: readonly StrokeData[];
  /** Per character, the misses on each of its strokes. */
  readonly misses: readonly (readonly number[])[];
};

export type WritingInProgress = Progress & {
  readonly finished: false;
  readonly character: number;
  readonly stroke: number;
};

export type WritingFinished = Progress & { readonly finished: true };

/** A writing card's quiz: the strokes of each character, in order. */
export type WritingQuiz = WritingInProgress | WritingFinished;

export type WritingQuizError =
  | { readonly kind: "no-character"; readonly character: number }
  | { readonly kind: "no-stroke"; readonly character: number; readonly stroke: number };

export type WritingStep = {
  readonly quiz: WritingQuiz;
  /** `null` for a tap: not judged. */
  readonly match: StrokeMatch | null;
};

/** Every point this close to the first is a tap: 2 px on the word page's 256 px grid. */
const TAP_RADIUS = 8;

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
export const showsHint = (quiz: WritingInProgress): boolean =>
  (quiz.misses[quiz.character]?.[quiz.stroke] ?? 0) >= HINT_AFTER_MISSES;

/** The current character's strokes, when the quiz has its current stroke and misses. */
const locate = (quiz: WritingInProgress): Result<StrokeData, WritingQuizError> => {
  const { character, stroke } = quiz;
  const data = quiz.characters[character] ?? null;
  if (data === null) return err({ kind: "no-character", character });
  const misses = quiz.misses[character]?.[stroke] ?? null;
  if (misses === null || stroke >= data.medians.length) {
    return err({ kind: "no-stroke", character, stroke });
  }
  return ok(data);
};

const withMisses = (quiz: WritingInProgress, update: (misses: number) => number) =>
  quiz.misses.map((counts, at) =>
    at === quiz.character
      ? counts.map((count, index) => (index === quiz.stroke ? update(count) : count))
      : counts,
  );

const moveOn = (
  quiz: WritingInProgress,
  data: StrokeData,
  misses: WritingQuiz["misses"],
): WritingQuiz => {
  const { characters, character, stroke } = quiz;
  if (stroke + 1 < data.medians.length) return { ...quiz, misses, stroke: stroke + 1 };
  if (character + 1 < characters.length) {
    return { ...quiz, misses, character: character + 1, stroke: 0 };
  }
  return { finished: true, characters, misses };
};

const isTap = (drawn: readonly StrokePoint[]): boolean => {
  const first = drawn.at(0) ?? null;
  return (
    first === null ||
    drawn.every((point) => Math.hypot(point[0] - first[0], point[1] - first[1]) < TAP_RADIUS)
  );
};

/**
 * Judges a stroke drawn for the current stroke. A match moves on to the next stroke, then to the
 * next character; anything else, a stroke drawn backwards included, is a miss on this stroke.
 */
export const drawStroke = (
  quiz: WritingInProgress,
  drawn: readonly StrokePoint[],
): Result<WritingStep, WritingQuizError> => {
  const located = locate(quiz);
  if (!located.ok) return located;
  if (isTap(drawn)) return ok({ quiz, match: null });
  const judged = strokeMatches(drawn, located.value, quiz.stroke);
  if (!judged.ok) return err({ kind: "no-stroke", character: quiz.character, stroke: quiz.stroke });
  const match = judged.value;
  return ok({
    quiz:
      match === "match"
        ? moveOn(quiz, located.value, quiz.misses)
        : { ...quiz, misses: withMisses(quiz, (count) => count + 1) },
    match,
  });
};

/**
 * Moves on as if the current stroke were drawn, counted as hinted, so the grade is again: the way
 * out of a stroke the learner cannot get through, like Hanzi Writer's `markStrokeCorrectAfterMisses`.
 * A few strokes miss even when traced exactly (see `strokeMatches`).
 */
export const revealStroke = (quiz: WritingInProgress): Result<WritingQuiz, WritingQuizError> => {
  const located = locate(quiz);
  if (!located.ok) return located;
  const misses = withMisses(quiz, (count) => Math.max(count, HINT_AFTER_MISSES));
  return ok(moveOn(quiz, located.value, misses));
};

/** No miss is good, misses without a hint hard, any hint again; never easy, as with the tone card. */
export const gradeWriting = (quiz: WritingFinished): Grade => {
  const misses = quiz.misses.flat();
  if (misses.some((count) => count >= HINT_AFTER_MISSES)) return "again";
  return misses.some((count) => count > 0) ? "hard" : "good";
};
