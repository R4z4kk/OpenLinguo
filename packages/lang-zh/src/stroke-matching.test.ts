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

/**
 * Hanzi Writer 3.7.3 misjudges these traced strokes (`[character, stroke]`): it measures distance to
 * the median's points, so the middle of a long segment looks far from the stroke.
 */
const MISSED_TRACES = [
  ["申", 4],
  ["果", 5],
  ["麻", 4],
  ["嘛", 11],
  ["沸", 7],
  ["瞅", 7],
  ["肺", 7],
] as const;
const UNFLAGGED_REVERSALS = [
  ["申", 4],
  ["果", 5],
  ["沸", 7],
  ["肺", 7],
] as const;
/** The next stroke, traced instead, passes for this one. */
const NEXT_ACCEPTED = [
  ["募", 5],
  ["夏", 5],
  ["嫌", 9],
  ["尊", 7],
  ["彰", 7],
  ["惠", 3],
  ["擅", 9],
  ["歉", 6],
  ["瀑", 5],
  ["矗", 4],
  ["矗", 5],
  ["矗", 12],
  ["矗", 13],
  ["矗", 21],
  ["蠢", 7],
  ["覆", 13],
  ["赚", 10],
  ["遵", 7],
  ["颤", 6],
  ["颤", 10],
  ["魔", 14],
  ["鹰", 9],
] as const;

const FORMS = [
  ["median", (median: readonly StrokePoint[]) => median],
  ["traced median", trace],
] as const;

describe("stroke matching on the stroke data", () => {
  const characters = new Map<string, StrokeData>();
  const NEEDED = new Set<string>([
    ...SAMPLE,
    ...[...MISSED_TRACES, ...UNFLAGGED_REVERSALS, ...NEXT_ACCEPTED].map(([character]) => character),
  ]);

  beforeAll(async () => {
    for (const [character, strokes, medians] of await loadStrokes()) {
      if (NEEDED.has(character)) characters.set(character, { strokes, medians });
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

  /** Stroke `drawn` of the character, traced, judged as stroke `index`. */
  const judgeTrace = (character: string, index: number, drawn: number, reversed: boolean) => {
    const data = characters.get(character) ?? null;
    const median = data?.medians[drawn] ?? null;
    if (data === null || median === null)
      throw new Error(`no stroke ${String(drawn)} in ${character}`);
    const traced = reversed ? trace(median).toReversed() : trace(median);
    const match = strokeMatches(traced, data, index);
    return `${character}#${String(index)} ${match.ok ? match.value : match.error.kind}`;
  };

  it("accepts the exact traces Hanzi Writer misses", () => {
    expect(
      MISSED_TRACES.map(([character, index]) => judgeTrace(character, index, index, false)),
    ).toEqual(MISSED_TRACES.map(([character, index]) => `${character}#${String(index)} match`));
  });

  it("flags the reversed traces Hanzi Writer does not", () => {
    expect(
      UNFLAGGED_REVERSALS.map(([character, index]) => judgeTrace(character, index, index, true)),
    ).toEqual(
      UNFLAGGED_REVERSALS.map(([character, index]) => `${character}#${String(index)} backwards`),
    );
  });

  it("rejects the next strokes Hanzi Writer accepts instead", () => {
    expect(
      NEXT_ACCEPTED.map(([character, index]) => judgeTrace(character, index, index + 1, false)),
    ).toEqual(NEXT_ACCEPTED.map(([character, index]) => `${character}#${String(index)} miss`));
  });

  it("accepts most noisy strokes at the chosen leniency", () => {
    const next = random(154);
    const judged = strokes().map(({ data, median, index }) =>
      strokeMatches(noisy(next, median, 15, 28), data, index, STROKE_LENIENCY),
    );
    const accepted = judged.filter((match) => match.ok && match.value === "match").length;
    // 85.2 % here, 84.9 % on all 30,052 strokes (the spike: 84.5 %).
    expect(accepted / judged.length).toBeGreaterThan(0.8);
  });
});
