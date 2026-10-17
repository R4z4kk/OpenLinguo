import {
  err,
  ok,
  startWritingQuiz,
  type StrokeData,
  type StrokePoint,
  type WritingInProgress,
  type WritingQuiz,
} from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import {
  characterReports,
  judgeStroke,
  REVEAL_AFTER_MISSES,
  strokePoint,
  wordStrokes,
  type StrokeFeedback,
} from "./writing-card.ts";

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
const SHI: StrokeData = { strokes: ["", ""], medians: [HORIZONTAL, VERTICAL] };
const YI: StrokeData = { strokes: [""], medians: [HORIZONTAL] };

const start = (...characters: StrokeData[]): WritingQuiz => {
  const started = startWritingQuiz(characters);
  if (!started.ok) throw new Error(started.error.kind);
  return started.value;
};

const inProgress = (quiz: WritingQuiz): WritingInProgress => {
  if (quiz.finished) throw new Error("finished");
  return quiz;
};

/** Judges the strokes in turn; the feedback of each. */
const judge = (
  quiz: WritingQuiz,
  ...strokes: (readonly StrokePoint[])[]
): { readonly quiz: WritingQuiz; readonly feedback: readonly (StrokeFeedback | null)[] } =>
  strokes.reduce<{ quiz: WritingQuiz; feedback: (StrokeFeedback | null)[] }>(
    (state, drawn) => {
      const judged = judgeStroke(inProgress(state.quiz), drawn);
      if (!judged.ok) throw new Error(judged.error.kind);
      return { quiz: judged.value.quiz, feedback: [...state.feedback, judged.value.feedback] };
    },
    { quiz, feedback: [] },
  );

describe("strokePoint", () => {
  it("maps the grid's corners and centre to the stroke data's box, y up", () => {
    const grid = { left: 100, top: 50, width: 280, height: 280 };
    expect(strokePoint(100, 50, grid)).toEqual([0, 900]);
    expect(strokePoint(380, 330, grid)).toEqual([1024, -124]);
    expect(strokePoint(240, 190, grid)).toEqual([512, 388]);
  });
});

describe("judgeStroke", () => {
  it("says which stroke was right and moves on", () => {
    const { quiz, feedback } = judge(start(SHI, YI), HORIZONTAL, VERTICAL);
    expect(feedback).toEqual([
      { kind: "right", stroke: 1 },
      { kind: "right", stroke: 2 },
    ]);
    expect(quiz).toMatchObject({ character: 1, stroke: 0 });
  });

  it("tells a miss from a stroke drawn backwards, and leaves a tap unjudged", () => {
    const { quiz, feedback } = judge(start(SHI), OFF, HORIZONTAL.toReversed(), [[500, 500]]);
    expect(feedback).toEqual([{ kind: "miss", stroke: 1 }, { kind: "backwards", stroke: 1 }, null]);
    expect(quiz).toMatchObject({ stroke: 0, misses: [[2, 0]] });
  });

  it("says the outline is shown on the third miss, then draws the stroke on the sixth", () => {
    const misses = Array.from({ length: REVEAL_AFTER_MISSES }, () => OFF);
    const { quiz, feedback } = judge(start(SHI), ...misses);
    expect(feedback.map((each) => each?.kind)).toEqual([
      "miss",
      "miss",
      "hint",
      "miss",
      "miss",
      "revealed",
    ]);
    expect(quiz).toMatchObject({ stroke: 1, misses: [[REVEAL_AFTER_MISSES, 0]] });
  });

  it("finishes on the last stroke of the last character", () => {
    expect(judge(start(SHI, YI), HORIZONTAL, VERTICAL, HORIZONTAL).quiz.finished).toBe(true);
  });
});

describe("characterReports", () => {
  it("counts each character's misses and names its hinted strokes", () => {
    const { quiz } = judge(start(SHI, YI), OFF, OFF, OFF, HORIZONTAL, VERTICAL, OFF, HORIZONTAL);
    if (!quiz.finished) throw new Error("not finished");
    expect(characterReports(quiz)).toEqual([
      { misses: 3, hinted: [1] },
      { misses: 1, hinted: [] },
    ]);
  });
});

describe("wordStrokes", () => {
  it("gives each character's strokes in order", async () => {
    const strokes = new Map([
      ["十", SHI],
      ["一", YI],
    ]);
    expect(
      await wordStrokes((character) => Promise.resolve(ok(strokes.get(character) ?? null)), "十一"),
    ).toEqual(ok([SHI, YI]));
  });

  it("fails on a character without strokes, or a lookup that fails", async () => {
    expect(await wordStrokes(() => Promise.resolve(ok(null)), "十")).toEqual(
      err({ kind: "no-strokes", character: "十" }),
    );
    const failure = err({ kind: "storage-failure", message: "gone" } as const);
    expect(await wordStrokes(() => Promise.resolve(failure), "十")).toEqual(failure);
  });
});
