import type { ToneClass } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { toneDoubts, type SyllableRecording } from "./tone-doubt.ts";

/** Pitch shapes in tenths of a semitone, 10 points: high level, rising, dipping, falling. */
const SHAPES: Readonly<Record<ToneClass, readonly number[]>> = {
  1: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  2: [-40, -35, -28, -20, -10, 0, 10, 22, 32, 40],
  3: [0, -15, -30, -45, -50, -50, -40, -25, -10, 0],
  4: [50, 42, 32, 20, 8, -5, -18, -30, -40, -50],
};

const recording = (
  key: string,
  tone: ToneClass,
  shape: ToneClass,
  heardTone: boolean,
): SyllableRecording => ({
  key,
  tone,
  contour: SHAPES[shape].map((point, index) => point + ((key.length + index) % 3)),
  heardTone,
});

const agreeing = ([1, 2, 3, 4] as const).flatMap((tone) =>
  ["a", "bb", "ccc"].map((suffix) => recording(`${String(tone)}${suffix}`, tone, tone, true)),
);

describe("toneDoubts", () => {
  it("doubts a syllable only when its character and its pitch both point to another tone", () => {
    const doubts = toneDoubts([
      ...agreeing,
      recording("falls instead of staying high", 1, 4, false),
      recording("stays high, character of another tone", 1, 1, false),
      recording("falls, character agrees", 1, 4, true),
    ]);
    expect(doubts.ok && [...doubts.value]).toEqual(["falls instead of staying high"]);
  });

  it("needs every tone among the agreeing recordings", () => {
    const doubts = toneDoubts(agreeing.filter((example) => example.tone !== 3));
    expect(doubts.ok || doubts.error.kind).toBe("missing-tone");
  });
});
