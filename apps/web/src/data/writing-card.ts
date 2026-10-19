import {
  drawStroke,
  err,
  HINT_AFTER_MISSES,
  ok,
  revealStroke,
  type LookupError,
  type Result,
  type StrokeData,
  type StrokeFeature,
  type StrokePoint,
  type WritingFinished,
  type WritingInProgress,
  type WritingQuiz,
  type WritingQuizError,
} from "@openlinguo/core";

/** The stroke data's box: 1024 units, y up from the baseline 900 units below the top. */
const BOX = 1024;
const BASELINE = 900;

/** Misses on a stroke before it is drawn for the learner: three more once its outline is shown. */
export const REVEAL_AFTER_MISSES = 2 * HINT_AFTER_MISSES;

type Box = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/** A pointer on the drawing grid, in the stroke data's units. */
export const strokePoint = (x: number, y: number, grid: Box): StrokePoint => [
  ((x - grid.left) / grid.width) * BOX,
  BASELINE - ((y - grid.top) / grid.height) * BOX,
];

/** Whether a stroke needed its outline shown, given its misses. */
export const hinted = (misses: number): boolean => misses >= HINT_AFTER_MISSES;

/** What the status line says of a judged stroke, numbered from 1. */
export type StrokeFeedback = {
  readonly kind: "right" | "miss" | "backwards" | "hint" | "revealed";
  readonly stroke: number;
};

export type JudgedStroke = { readonly quiz: WritingQuiz; readonly feedback: StrokeFeedback | null };

/**
 * Judges a stroke for the current one; `feedback: null` for a tap. The miss that shows the outline
 * says so, and the sixth miss draws the stroke for the learner, so a stuck learner can always finish.
 */
export const judgeStroke = (
  quiz: WritingInProgress,
  drawn: readonly StrokePoint[],
): Result<JudgedStroke, WritingQuizError> => {
  const step = drawStroke(quiz, drawn);
  if (!step.ok) return step;
  const { quiz: next, match } = step.value;
  const stroke = quiz.stroke + 1;
  if (match === null) return ok({ quiz, feedback: null });
  // A miss never finishes the quiz.
  if (match === "match" || next.finished)
    return ok({ quiz: next, feedback: { kind: "right", stroke } });
  const misses = next.misses[next.character]?.[next.stroke] ?? 0;
  if (misses >= REVEAL_AFTER_MISSES) {
    const revealed = revealStroke(next);
    return revealed.ok
      ? ok({ quiz: revealed.value, feedback: { kind: "revealed", stroke } })
      : revealed;
  }
  return ok({
    quiz: next,
    feedback: { kind: misses === HINT_AFTER_MISSES ? "hint" : match, stroke },
  });
};

/** Per character: its misses, and its strokes drawn after a hint, numbered from 1. */
export const characterReports = (
  quiz: WritingFinished,
): readonly { readonly misses: number; readonly hinted: readonly number[] }[] =>
  quiz.misses.map((counts) => ({
    misses: counts.reduce((sum, count) => sum + count, 0),
    hinted: counts.flatMap((count, index) => (hinted(count) ? [index + 1] : [])),
  }));

export type WordStrokesError =
  LookupError | { readonly kind: "no-strokes"; readonly character: string };

/** The strokes of each character of a word, in order. */
export const wordStrokes = async (
  strokesOf: StrokeFeature["strokesOf"],
  headword: string,
): Promise<Result<readonly StrokeData[], WordStrokesError>> => {
  const characters = Array.from(headword);
  const found = await Promise.all(characters.map((character) => strokesOf(character)));
  const strokes: StrokeData[] = [];
  for (const [index, result] of found.entries()) {
    if (!result.ok) return result;
    if (result.value === null)
      return err({ kind: "no-strokes", character: characters[index] ?? "" });
    strokes.push(result.value);
  }
  return ok(strokes);
};
