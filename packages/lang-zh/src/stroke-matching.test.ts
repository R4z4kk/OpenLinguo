import { STROKE_LENIENCY, strokeMatches, type Point, type StrokeData } from "@openlinguo/core";
import { beforeAll, describe, expect, it } from "vitest";
import { loadStrokes } from "./testing/dataset-shards.ts";

/** From one stroke to seventeen, with dots, hooks, turns and sweeps. */
const SAMPLE = Array.from("一乙九人口女飞弓心永必写好字你我国爱舞鼻嘴赢藏戴");

/** Deterministic, uniform in [0, 1): mulberry32. */
const random = (seed: number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * As in ADR 0011's spike: the median resampled to 6 points per segment, shifted `shift` units in a
 * random direction, with Gaussian noise of `sigma` units on each coordinate.
 */
const noisy = (
  next: () => number,
  median: readonly Point[],
  sigma: number,
  shift: number,
): readonly Point[] => {
  const gauss = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  const theta = 2 * Math.PI * next();
  const resampled = median.flatMap((point, index): Point[] => {
    const after = median[index + 1] ?? null;
    if (after === null) return [point];
    return [0, 1, 2, 3, 4, 5].map((step) => [
      point[0] + ((after[0] - point[0]) * step) / 6,
      point[1] + ((after[1] - point[1]) * step) / 6,
    ]);
  });
  return resampled.map(([x, y]) => [
    x + shift * Math.cos(theta) + sigma * gauss(),
    y + shift * Math.sin(theta) + sigma * gauss(),
  ]);
};

describe("stroke matching on the stroke data", () => {
  const characters = new Map<string, StrokeData>();

  beforeAll(async () => {
    for (const [character, strokes, medians] of await loadStrokes()) {
      if (SAMPLE.includes(character)) characters.set(character, { strokes, medians });
    }
  });

  /** Every stroke of the sample, with its character's data and index. */
  const strokes = () =>
    SAMPLE.flatMap((character) => {
      const data = characters.get(character) ?? null;
      if (data === null) throw new Error(`no stroke data for ${character}`);
      return data.medians.map((median, index) => ({ character, data, median, index }));
    });

  it("accepts each stroke's median", () => {
    const judged = strokes().map(({ character, data, median, index }) => ({
      character,
      index,
      match: strokeMatches(median, data, index),
    }));
    expect(judged.length).toBe(176);
    expect(judged.filter(({ match }) => !match.ok || match.value !== "match")).toEqual([]);
  });

  it("flags a reversed median backwards", () => {
    const judged = strokes().map(({ character, data, median, index }) => ({
      character,
      index,
      match: strokeMatches(median.toReversed(), data, index),
    }));
    expect(judged.filter(({ match }) => !match.ok || match.value !== "backwards")).toEqual([]);
  });

  it("rejects the next stroke drawn instead", () => {
    const judged = strokes().flatMap(({ character, data, index }) => {
      const next = data.medians[index + 1] ?? null;
      return next === null ? [] : [{ character, index, match: strokeMatches(next, data, index) }];
    });
    expect(judged.length).toBe(176 - SAMPLE.length);
    expect(judged.filter(({ match }) => !match.ok || match.value === "match")).toEqual([]);
  });

  it("accepts most noisy strokes at the chosen leniency", () => {
    const next = random(154);
    const judged = strokes().map(({ data, median, index }) =>
      strokeMatches(noisy(next, median, 15, 28), data, index, STROKE_LENIENCY),
    );
    const accepted = judged.filter((match) => match.ok && match.value === "match").length;
    // 85.2 % here; the spike's 84.5 % on all 30,052 strokes.
    expect(accepted / judged.length).toBeGreaterThan(0.8);
  });
});
