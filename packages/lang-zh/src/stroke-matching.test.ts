import {
  STROKE_LENIENCY,
  strokeMatches,
  type StrokeData,
  type StrokePoint,
} from "@openlinguo/core";
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
  median: readonly StrokePoint[],
  sigma: number,
  shift: number,
): readonly StrokePoint[] => {
  const gauss = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  const theta = 2 * Math.PI * next();
  const resampled = median.flatMap((point, index): StrokePoint[] => {
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

/** The median as a pointer draws it: a point every 8 units along it. */
const trace = (median: readonly StrokePoint[]): readonly StrokePoint[] =>
  median.flatMap((point, index): StrokePoint[] => {
    const before = median[index - 1] ?? null;
    if (before === null) return [point];
    const count = Math.ceil(Math.hypot(point[0] - before[0], point[1] - before[1]) / 8);
    return Array.from({ length: count }, (_, step): StrokePoint => [
      before[0] + ((point[0] - before[0]) * (step + 1)) / count,
      before[1] + ((point[1] - before[1]) * (step + 1)) / count,
    ]);
  });

const FORMS = [
  ["median", (median: readonly StrokePoint[]) => median],
  ["traced median", trace],
] as const;

describe("stroke matching on the stroke data", () => {
  const characters = new Map<string, StrokeData>();

  beforeAll(async () => {
    for (const [character, strokes, medians] of await loadStrokes()) {
      if (SAMPLE.includes(character) || character === "申") {
        characters.set(character, { strokes, medians });
      }
    }
  });

  /** Every stroke of the sample, with its character's data and index. */
  const strokes = () =>
    SAMPLE.flatMap((character) => {
      const data = characters.get(character) ?? null;
      if (data === null) throw new Error(`no stroke data for ${character}`);
      return data.medians.map((median, index) => ({ character, data, median, index }));
    });

  it.each(FORMS)("accepts each stroke's %s", (_, form) => {
    const judged = strokes().map(({ character, data, median, index }) => ({
      character,
      index,
      match: strokeMatches(form(median), data, index),
    }));
    expect(judged.length).toBe(176);
    expect(judged.filter(({ match }) => !match.ok || match.value !== "match")).toEqual([]);
  });

  it.each(FORMS)("flags a reversed %s backwards", (_, form) => {
    const judged = strokes().map(({ character, data, median, index }) => ({
      character,
      index,
      match: strokeMatches(form(median).toReversed(), data, index),
    }));
    expect(judged.filter(({ match }) => !match.ok || match.value !== "backwards")).toEqual([]);
  });

  it.each(FORMS)("rejects the next stroke's %s drawn instead", (_, form) => {
    const judged = strokes().flatMap(({ character, data, index }) => {
      const next = data.medians[index + 1] ?? null;
      if (next === null) return [];
      return [{ character, index, match: strokeMatches(form(next), data, index) }];
    });
    expect(judged.length).toBe(176 - SAMPLE.length);
    expect(judged.filter(({ match }) => !match.ok || match.value === "match")).toEqual([]);
  });

  it("misses a few exact traces, as Hanzi Writer does", () => {
    // 7 of the 30,052 strokes. Distances go to the median's points; 申's vertical is mostly one segment.
    const shen = characters.get("申") ?? null;
    const vertical = shen?.medians[4] ?? null;
    if (shen === null || vertical === null) throw new Error("no stroke data for 申");
    expect(strokeMatches(vertical, shen, 4)).toEqual({ ok: true, value: "match" });
    expect(strokeMatches(trace(vertical), shen, 4)).toEqual({ ok: true, value: "miss" });
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
