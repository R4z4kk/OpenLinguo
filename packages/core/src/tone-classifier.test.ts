import { describe, expect, test } from "vitest";
import type { Contour } from "./f0.ts";
import {
  classifyTone,
  MIN_CONFIDENCE,
  toneFeatures,
  trainToneModel,
  type ToneClass,
} from "./tone-classifier.ts";

const SHAPES: Readonly<Record<ToneClass, Contour>> = {
  1: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  2: [-40, -30, -20, -10, 0, 10, 20, 30, 40, 50],
  3: [10, 0, -15, -30, -35, -30, -15, null, null, null],
  4: [40, 35, 25, 15, 5, -10, -25, -40, -50, -55],
};

/** A few copies of each shape with a small deterministic wobble. */
const examples = (wobble: number) =>
  ([1, 2, 3, 4] as const).flatMap((tone) =>
    [-1, 0, 1].map((side) => ({
      tone,
      contour: SHAPES[tone].map((value, at) =>
        value === null ? null : value + side * wobble * ((at % 3) - 1),
      ),
    })),
  );

describe("toneFeatures", () => {
  test("fills an unvoiced point from its neighbours and counts the unvoiced ones", () => {
    const features = toneFeatures([0, null, 20, null, null, 50, 50, 50, null, null]);
    expect(features).toEqual({
      ok: true,
      value: [0, 10, 20, 30, 40, 50, 50, 50, 50, 50, 50],
    });
  });

  test("refuses a contour with no voice or of another length", () => {
    expect(toneFeatures(Array(10).fill(null))).toEqual({ ok: false, error: { kind: "unvoiced" } });
    expect(toneFeatures([1, 2, 3])).toEqual({
      ok: false,
      error: { kind: "bad-contour", points: 3 },
    });
  });
});

describe("trainToneModel", () => {
  test("needs every tone", () => {
    const only = examples(0).filter(({ tone }) => tone !== 3);
    expect(trainToneModel(only)).toEqual({ ok: false, error: { kind: "missing-tone", tone: 3 } });
  });

  test("reports a contour it cannot use", () => {
    expect(trainToneModel([{ tone: 1, contour: [1, 2] }])).toEqual({
      ok: false,
      error: { kind: "bad-contour", points: 2 },
    });
  });
});

describe("classifyTone", () => {
  const trained = trainToneModel(examples(4));
  if (!trained.ok) throw new Error("model not trained");
  const model = trained.value;

  test.each([1, 2, 3, 4] as const)(
    "tells the synthetic tone %i from a model trained on them",
    (tone) => {
      const guess = classifyTone(SHAPES[tone], model);
      expect(guess.ok && guess.value.tone).toBe(tone);
      expect(guess.ok && guess.value.confidence).toBeGreaterThan(MIN_CONFIDENCE);
    },
  );

  test("is low for a contour midway between two tones, and always between 0 and 1", () => {
    const midway = SHAPES[2].map((value) => (value ?? 0) / 2);
    const guess = classifyTone(midway, model);
    expect(guess.ok && guess.value.confidence).toBeGreaterThanOrEqual(0);
    expect(guess.ok && guess.value.confidence).toBeLessThan(MIN_CONFIDENCE);
    for (const shape of Object.values(SHAPES)) {
      const result = classifyTone(shape, model);
      expect(result.ok && result.value.confidence).toBeLessThanOrEqual(1);
    }
  });

  test("refuses what is not a voiced syllable contour", () => {
    expect(classifyTone(Array(10).fill(null), model)).toEqual({
      ok: false,
      error: { kind: "unvoiced" },
    });
  });

  test("the shipped model reads a flat, a rising and a falling syllable", () => {
    for (const [tone, shape] of [
      [1, SHAPES[1]],
      [2, SHAPES[2]],
      [4, SHAPES[4]],
    ] as const) {
      const guess = classifyTone(shape);
      expect(guess.ok && guess.value.tone).toBe(tone);
    }
  });
});
