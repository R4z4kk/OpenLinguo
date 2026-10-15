import { describe, expect, test } from "vitest";
import type { Contour } from "./f0.ts";
import { scorePronunciation } from "./pronunciation.ts";
import { TONE_MODEL } from "./tone-model.ts";

/** The model's mean contour of a tone, its usual unvoiced points last: heard as that tone. */
const shape = (tone: 1 | 2 | 4): Contour => {
  const centroid = TONE_MODEL.centroids[tone - 1] ?? [];
  const unvoiced = Math.round((centroid[10] ?? 0) / 10);
  return centroid.slice(0, 10).map((value, at) => (at < 10 - unvoiced ? Math.round(value) : null));
};

const unvoiced: Contour = Array<null>(10).fill(null);

describe("scorePronunciation", () => {
  test("hears the expected tone and measures the gap to the reference", () => {
    const voice = [...shape(4), ...shape(1)];
    const reference = [
      ...shape(4).map((value) => (value === null ? null : value + 20)),
      ...shape(1),
    ];
    expect(scorePronunciation(voice, reference, [4, 1])).toEqual({
      ok: true,
      value: [
        { verdict: { kind: "right" }, distance: 2 },
        { verdict: { kind: "right" }, distance: 0 },
      ],
    });
  });

  test("names the tone heard when it is another one", () => {
    const score = scorePronunciation(shape(2), shape(4), [4]);
    expect(score.ok && score.value[0]?.verdict).toEqual({ kind: "other", tone: 2 });
  });

  test("does not judge a neutral tone, nor a silent syllable", () => {
    const score = scorePronunciation(
      [...shape(1), ...unvoiced],
      [...shape(1), ...shape(1)],
      [5, 2],
    );
    expect(score).toEqual({
      ok: true,
      value: [
        { verdict: { kind: "neutral" }, distance: 0 },
        { verdict: { kind: "unvoiced" }, distance: null },
      ],
    });
  });

  test("refuses contours that do not match the syllables", () => {
    expect(scorePronunciation(shape(1), shape(1), [1, 1])).toEqual({
      ok: false,
      error: { kind: "length-mismatch" },
    });
    expect(scorePronunciation([], [], [])).toEqual({
      ok: false,
      error: { kind: "length-mismatch" },
    });
  });
});
