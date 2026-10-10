import { describe, expect, it } from "vitest";
import { medianPath, polylineLength, strokeDuration } from "./strokes.ts";

describe("strokes", () => {
  it("draws a median as a polyline", () => {
    expect(
      medianPath([
        [121, 393],
        [193, 372],
        [920, 401],
      ]),
    ).toBe("M 121 393 L 193 372 L 920 401");
  });

  it("measures a median", () => {
    expect(
      polylineLength([
        [0, 0],
        [3, 4],
        [3, 10],
      ]),
    ).toBe(11);
    expect(polylineLength([[5, 5]])).toBe(0);
  });

  it("gives longer strokes more time", () => {
    expect(strokeDuration(900)).toBe(500);
    expect(strokeDuration(100)).toBeLessThan(strokeDuration(900));
  });
});
