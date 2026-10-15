import "fake-indexeddb/auto";
import { F0_VERSION, POINTS_PER_SYLLABLE } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { storedContour } from "./pronunciation.ts";

const TWO_SYLLABLES = Array.from({ length: 2 * POINTS_PER_SYLLABLE }, (_, at) => at);

describe("storedContour", () => {
  it("uses the pack's contour when this app's contour code made it", () => {
    expect(storedContour({ f0: TWO_SYLLABLES, f0Version: F0_VERSION }, 2)).toBe(TWO_SYLLABLES);
  });

  it("leaves a contour of another or an unknown version to be computed again", () => {
    expect(storedContour({ f0: TWO_SYLLABLES, f0Version: "pitchy-0.0.0/v0" }, 2)).toBeNull();
    expect(storedContour({ f0: TWO_SYLLABLES, f0Version: null }, 2)).toBeNull();
  });

  it("leaves a missing contour or one cut for another syllable count to be computed", () => {
    expect(storedContour({ f0: null, f0Version: F0_VERSION }, 2)).toBeNull();
    expect(storedContour({ f0: TWO_SYLLABLES, f0Version: F0_VERSION }, 3)).toBeNull();
  });
});
