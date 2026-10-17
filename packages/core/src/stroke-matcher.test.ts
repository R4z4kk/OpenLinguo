import { describe, expect, test } from "vitest";
import type { StrokeData } from "./language-pack.ts";
import { strokeMatches, type StrokePoint } from "./stroke-matcher.ts";

const character = (...medians: (readonly StrokePoint[])[]): StrokeData => ({
  strokes: medians.map(() => ""),
  medians,
});

const shift = (points: readonly StrokePoint[], dx: number, dy: number): readonly StrokePoint[] =>
  points.map(([x, y]) => [x + dx, y + dy]);

// 三 drawn as three horizontal strokes, top to bottom, and a vertical one.
const TOP: readonly StrokePoint[] = [
  [200, 700],
  [500, 710],
  [800, 700],
];
const MIDDLE = shift(TOP, 0, -150);
const BOTTOM = shift(TOP, 0, -300);
const SAN = character(TOP, MIDDLE, BOTTOM);

describe("strokeMatches", () => {
  test("the median itself matches, every stroke", () => {
    for (const [index, median] of SAN.medians.entries()) {
      expect(strokeMatches(median, SAN, index)).toEqual({ ok: true, value: "match" });
    }
  });

  test("a stroke drawn the other way is flagged backwards", () => {
    expect(strokeMatches(TOP.toReversed(), SAN, 0)).toEqual({ ok: true, value: "backwards" });
  });

  test("a stroke elsewhere or of another shape misses", () => {
    const vertical: readonly StrokePoint[] = [
      [500, 900],
      [500, 100],
    ];
    expect(strokeMatches(vertical, SAN, 0)).toEqual({ ok: true, value: "miss" });
    expect(strokeMatches(TOP.slice(0, 2), SAN, 0)).toEqual({ ok: true, value: "miss" });
  });

  test("a later stroke drawn instead is judged with less leniency", () => {
    expect(strokeMatches(MIDDLE, SAN, 0)).toEqual({ ok: true, value: "miss" });
    expect(strokeMatches(shift(TOP, 0, -40), SAN, 0)).toEqual({ ok: true, value: "match" });
  });

  test("strokes after the first are held closer to their place", () => {
    const single = character(TOP);
    expect(strokeMatches(shift(TOP, 0, -200), single, 0)).toEqual({ ok: true, value: "match" });
    expect(strokeMatches(shift(BOTTOM, 0, -200), SAN, 2)).toEqual({ ok: true, value: "miss" });
  });

  test("distance goes to the median's segments, not its points", () => {
    // 十's vertical: to its two ends, a trace would average 200 units, over the 175 allowed.
    const vertical: readonly StrokePoint[] = [
      [500, 850],
      [500, 50],
    ];
    const shi = character(shift(TOP, 0, -250), vertical);
    const traced = Array.from({ length: 81 }, (_, step): StrokePoint => [500, 850 - step * 10]);
    expect(strokeMatches(traced, shi, 1)).toEqual({ ok: true, value: "match" });
    expect(strokeMatches(traced.toReversed(), shi, 1)).toEqual({ ok: true, value: "backwards" });
  });

  test("leniency widens every threshold", () => {
    const sloppy = shift(TOP, 0, -260);
    const single = character(TOP);
    expect(strokeMatches(sloppy, single, 0)).toEqual({ ok: true, value: "miss" });
    expect(strokeMatches(sloppy, single, 0, 1.5)).toEqual({ ok: true, value: "match" });
  });

  test("repeated points count once: a tap misses", () => {
    expect(strokeMatches([[200, 700]], SAN, 0)).toEqual({ ok: true, value: "miss" });
    expect(
      strokeMatches(
        [
          [200, 700],
          [200, 700],
        ],
        SAN,
        0,
      ),
    ).toEqual({ ok: true, value: "miss" });
    const doubled = TOP.flatMap((point) => [point, point]);
    expect(strokeMatches(doubled, SAN, 0)).toEqual({ ok: true, value: "match" });
  });

  test("refuses a stroke the character does not have", () => {
    expect(strokeMatches(TOP, SAN, 3)).toEqual({
      ok: false,
      error: { kind: "no-stroke", index: 3 },
    });
    expect(strokeMatches(TOP, SAN, -1)).toEqual({
      ok: false,
      error: { kind: "no-stroke", index: -1 },
    });
  });
});
