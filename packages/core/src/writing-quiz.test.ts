import { describe, expect, test } from "vitest";
import type { StrokeData } from "./language-pack.ts";
import type { StrokePoint } from "./stroke-matcher.ts";
import {
  drawStroke,
  gradeWriting,
  HINT_AFTER_MISSES,
  revealStroke,
  showsHint,
  startWritingQuiz,
  type WritingQuiz,
} from "./writing-quiz.ts";

const HORIZONTAL: readonly StrokePoint[] = [
  [150, 450],
  [850, 450],
];
const VERTICAL: readonly StrokePoint[] = [
  [500, 800],
  [500, 50],
];
const OFF: readonly StrokePoint[] = [
  [50, 50],
  [60, 950],
];

// 十 then 一.
const SHI: StrokeData = { strokes: ["", ""], medians: [HORIZONTAL, VERTICAL] };
const YI: StrokeData = { strokes: [""], medians: [HORIZONTAL] };

const start = (...characters: StrokeData[]): WritingQuiz => {
  const started = startWritingQuiz(characters);
  if (!started.ok) throw new Error(started.error.kind);
  return started.value;
};

/** Draws the strokes in turn, each judged on the quiz the last one left. */
const draw = (quiz: WritingQuiz, ...strokes: (readonly StrokePoint[])[]): WritingQuiz =>
  strokes.reduce((current, drawn) => {
    if (current.finished) throw new Error("finished");
    const step = drawStroke(current, drawn);
    if (!step.ok) throw new Error(step.error.kind);
    return step.value.quiz;
  }, quiz);

describe("writing quiz", () => {
  test("starts on the first stroke of the first character, without miss", () => {
    expect(start(SHI, YI)).toEqual({
      finished: false,
      characters: [SHI, YI],
      misses: [[0, 0], [0]],
      character: 0,
      stroke: 0,
    });
  });

  test("a match moves on to the next stroke, then the next character, then finishes", () => {
    const quiz = start(SHI, YI);
    expect(draw(quiz, HORIZONTAL)).toMatchObject({ finished: false, character: 0, stroke: 1 });
    expect(draw(quiz, HORIZONTAL, VERTICAL)).toMatchObject({ character: 1, stroke: 0 });
    expect(draw(quiz, HORIZONTAL, VERTICAL, HORIZONTAL)).toEqual({
      finished: true,
      characters: [SHI, YI],
      misses: [[0, 0], [0]],
    });
  });

  test("a miss or a backwards stroke stays on the stroke and counts", () => {
    const quiz = start(SHI);
    if (quiz.finished) throw new Error("finished");
    const missed = drawStroke(quiz, OFF);
    expect(missed.ok && missed.value.match).toBe("miss");
    const backwards = drawStroke(quiz, HORIZONTAL.toReversed());
    expect(backwards.ok && backwards.value.match).toBe("backwards");
    expect(draw(quiz, OFF, HORIZONTAL.toReversed(), HORIZONTAL, OFF)).toMatchObject({
      character: 0,
      stroke: 1,
      misses: [[2, 1]],
    });
  });

  test("a tap, even with a little jitter, is not judged", () => {
    const quiz = start(SHI);
    if (quiz.finished) throw new Error("finished");
    for (const tap of [
      [],
      [[500, 500]],
      [
        [500, 500],
        [500, 500],
      ],
      [
        [500, 500],
        [503.5, 498.25],
        [494.5, 503],
      ],
    ] satisfies StrokePoint[][]) {
      expect(drawStroke(quiz, tap)).toEqual({ ok: true, value: { quiz, match: null } });
    }
    const flick = drawStroke(quiz, [
      [500, 500],
      [510, 500],
    ]);
    expect(flick.ok && flick.value.match).toBe("miss");
  });

  test("the hint shows after three misses on a stroke, until it is drawn", () => {
    const quiz = start(SHI);
    const hinted = (current: WritingQuiz) => !current.finished && showsHint(current);
    expect(HINT_AFTER_MISSES).toBe(3);
    expect(hinted(draw(quiz, OFF, OFF))).toBe(false);
    expect(hinted(draw(quiz, OFF, OFF, OFF))).toBe(true);
    expect(hinted(draw(quiz, OFF, OFF, OFF, OFF))).toBe(true);
    expect(hinted(draw(quiz, OFF, OFF, OFF, HORIZONTAL))).toBe(false);
    expect(hinted(draw(quiz, OFF, HORIZONTAL, OFF, OFF))).toBe(false);
  });

  test("revealing a stroke moves on and counts as hinted", () => {
    const reveal = (quiz: WritingQuiz): WritingQuiz => {
      if (quiz.finished) throw new Error("finished");
      const revealed = revealStroke(quiz);
      if (!revealed.ok) throw new Error(revealed.error.kind);
      return revealed.value;
    };
    const quiz = start(SHI, YI);
    expect(reveal(quiz)).toMatchObject({ character: 0, stroke: 1, misses: [[3, 0], [0]] });
    expect(reveal(draw(quiz, OFF, OFF, OFF, OFF))).toMatchObject({ misses: [[4, 0], [0]] });
    const revealedLast = reveal(draw(quiz, HORIZONTAL, VERTICAL));
    expect(revealedLast).toEqual({ finished: true, characters: [SHI, YI], misses: [[0, 0], [3]] });
    expect(revealedLast.finished && gradeWriting(revealedLast)).toBe("again");
  });

  test("grades: no miss good, misses without a hint hard, any hint again, never easy", () => {
    const grade = (quiz: WritingQuiz) => (quiz.finished ? gradeWriting(quiz) : null);
    const quiz = start(SHI, YI);
    expect(grade(draw(quiz, HORIZONTAL, VERTICAL, HORIZONTAL))).toBe("good");
    expect(grade(draw(quiz, OFF, HORIZONTAL, VERTICAL, HORIZONTAL))).toBe("hard");
    expect(grade(draw(quiz, OFF, OFF, HORIZONTAL, OFF, OFF, VERTICAL, OFF, OFF, HORIZONTAL))).toBe(
      "hard",
    );
    expect(grade(draw(quiz, HORIZONTAL, VERTICAL, OFF, OFF, OFF, HORIZONTAL))).toBe("again");
  });

  test("refuses what it cannot quiz", () => {
    expect(startWritingQuiz([])).toEqual({
      ok: false,
      error: { kind: "no-character", character: 0 },
    });
    expect(startWritingQuiz([SHI, { strokes: [], medians: [] }])).toEqual({
      ok: false,
      error: { kind: "no-stroke", character: 1, stroke: 0 },
    });
    const quiz = {
      finished: false,
      characters: [YI],
      misses: [[0]],
      character: 0,
      stroke: 0,
    } as const;
    expect(drawStroke({ ...quiz, character: 1 }, HORIZONTAL)).toEqual({
      ok: false,
      error: { kind: "no-character", character: 1 },
    });
    expect(drawStroke({ ...quiz, stroke: 1 }, HORIZONTAL)).toEqual({
      ok: false,
      error: { kind: "no-stroke", character: 0, stroke: 1 },
    });
    expect(drawStroke({ ...quiz, misses: [[]] }, OFF)).toEqual({
      ok: false,
      error: { kind: "no-stroke", character: 0, stroke: 0 },
    });
    expect(revealStroke({ ...quiz, character: 1 })).toEqual({
      ok: false,
      error: { kind: "no-character", character: 1 },
    });
  });
});
