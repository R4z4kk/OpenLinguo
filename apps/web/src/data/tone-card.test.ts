import { describe, expect, it } from "vitest";
import { spokenReading, toneSyllables } from "./tone-card.ts";

describe("toneSyllables", () => {
  it("lists the syllables with their citation tone", () => {
    expect(toneSyllables("ni3 hao3")).toEqual([
      { letters: "ni", tone: 3 },
      { letters: "hao", tone: 3 },
    ]);
  });

  it("leaves the erhua suffix out, as it is said inside the syllable before it", () => {
    expect(toneSyllables("yi1 dian3 r5")?.map(({ letters }) => letters)).toEqual(["yi", "dian"]);
  });

  it("keeps the neutral tone of a syllable", () => {
    expect(toneSyllables("ma1 ma5")?.map(({ tone }) => tone)).toEqual([1, 5]);
  });

  it("has none for a reading with no tone to hear, or an invalid one", () => {
    expect(toneSyllables("ma5")).toBeNull();
    expect(toneSyllables("xyz9")).toBeNull();
    expect(toneSyllables("")).toBeNull();
  });
});

describe("spokenReading", () => {
  it("applies the third-tone sandhi", () => {
    expect(spokenReading("你好", "ni3 hao3")).toEqual({ reading: "ni2 hao3", tones: [2, 3] });
  });

  it("applies the 一 sandhi in the word", () => {
    expect(spokenReading("一下", "yi1 xia4")).toEqual({ reading: "yi2 xia4", tones: [2, 4] });
  });

  it("leaves a word without sandhi as it is", () => {
    expect(spokenReading("天", "tian1")).toEqual({ reading: "tian1", tones: [1] });
  });

  it("falls back to the citation tones when sandhi cannot be applied", () => {
    expect(spokenReading("一个", "yi1")).toEqual({ reading: "yi1", tones: [1] });
  });

  it("is null for an invalid reading", () => {
    expect(spokenReading("好", "xyz9")).toBeNull();
  });
});
