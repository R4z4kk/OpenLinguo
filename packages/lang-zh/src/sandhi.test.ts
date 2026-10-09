import { describe, expect, it } from "vitest";
import { applySandhi } from "./sandhi.ts";

const spoken = (...words: (readonly [text: string, reading: string])[]) =>
  applySandhi(words.map(([text, reading]) => ({ text, reading })));

const expectSpoken = (
  words: (readonly [text: string, reading: string])[],
  expected: readonly string[],
): void => {
  expect(spoken(...words)).toEqual({ ok: true, value: expected });
};

describe("不 sandhi", () => {
  it("becomes bu2 before a fourth tone", () => {
    expectSpoken([["不是", "bu4 shi4"]], ["bu2 shi4"]);
    expectSpoken(
      [
        ["不", "bu4"],
        ["对", "dui4"],
      ],
      ["bu2", "dui4"],
    );
  });

  it("keeps bu4 before other tones and in A-not-A neutral readings", () => {
    expectSpoken(
      [
        ["不", "bu4"],
        ["好", "hao3"],
      ],
      ["bu4", "hao3"],
    );
    expectSpoken([["是不是", "shi4 bu5 shi4"]], ["shi4 bu5 shi4"]);
  });
});

describe("一 sandhi", () => {
  it.each([
    ["一个", "yi1 ge5", "yi2 ge5"],
    ["一样", "yi1 yang4", "yi2 yang4"],
    ["一天", "yi1 tian1", "yi4 tian1"],
    ["一年", "yi1 nian2", "yi4 nian2"],
    ["一起", "yi1 qi3", "yi4 qi3"],
    ["一百", "yi1 bai3", "yi4 bai3"],
  ])("%s %s → %s", (text, reading, expected) => {
    expectSpoken([[text, reading]], [expected]);
  });

  it.each([
    ["第一", "di4 yi1"],
    ["统一", "tong3 yi1"],
    ["一", "yi1"],
    ["一九八四", "yi1 jiu3 ba1 si4"],
    ["一月", "yi1 yue4"],
    ["十一", "shi2 yi1"],
  ])("keeps yi1 in %s", (text, reading) => {
    expectSpoken([[text, reading]], [reading]);
  });

  it("keeps yi1 at the end of a multi-syllable word followed by another word", () => {
    expectSpoken(
      [
        ["统一", "tong3 yi1"],
        ["的", "de5"],
      ],
      ["tong3 yi1", "de5"],
    );
  });

  it("becomes neutral between a reduplicated verb", () => {
    expectSpoken([["看一看", "kan4 yi1 kan4"]], ["kan4 yi5 kan4"]);
  });

  it("stops at punctuation", () => {
    expectSpoken(
      [["一个天南，一个", "yi1 ge5 tian1 nan2 , yi1 ge5"]],
      ["yi2 ge5 tian1 nan2 , yi2 ge5"],
    );
  });
});

describe("third tone sandhi", () => {
  it("changes the first of two third tones in a word", () => {
    expectSpoken([["你好", "ni3 hao3"]], ["ni2 hao3"]);
  });

  it("changes every third tone but the last inside a word", () => {
    expectSpoken([["展览馆", "zhan3 lan3 guan3"]], ["zhan2 lan2 guan3"]);
  });

  it("joins a word with a following monosyllable", () => {
    expectSpoken(
      [
        ["保管", "bao3 guan3"],
        ["好", "hao3"],
      ],
      ["bao2 guan2", "hao3"],
    );
  });

  it("keeps a monosyllable before a word whose first tone already changed", () => {
    expectSpoken(
      [
        ["纸", "zhi3"],
        ["老虎", "lao3 hu3"],
      ],
      ["zhi3", "lao2 hu3"],
    );
    expectSpoken(
      [
        ["我", "wo3"],
        ["很", "hen3"],
        ["好", "hao3"],
      ],
      ["wo3", "hen2", "hao3"],
    );
  });

  it("keeps two multi-syllable words apart", () => {
    expectSpoken(
      [
        ["水果", "shui3 guo3"],
        ["好吃", "hao3 chi1"],
      ],
      ["shui2 guo3", "hao3 chi1"],
    );
  });

  it("alternates along a chain of monosyllables", () => {
    expectSpoken(
      [
        ["我", "wo3"],
        ["想", "xiang3"],
        ["买", "mai3"],
        ["五", "wu3"],
        ["本", "ben3"],
        ["小说", "xiao3 shuo1"],
      ],
      ["wo2", "xiang3", "mai2", "wu3", "ben2", "xiao3 shuo1"],
    );
  });

  it("keeps ü and capitals in the output", () => {
    expectSpoken([["女子", "nu:3 zi3"]], ["nu:2 zi3"]);
    expectSpoken([["北海", "Bei3 hai3"]], ["Bei2 hai3"]);
  });
});

describe("applySandhi errors", () => {
  it("rejects an invalid reading", () => {
    expect(spoken(["你", "ni9"])).toEqual({
      ok: false,
      error: { kind: "invalid-reading", reading: "ni9" },
    });
  });

  it("rejects a reading not aligned with a word containing 一 or 不", () => {
    expect(spoken(["11区不", "11 Qu1 bu4"])).toEqual({
      ok: false,
      error: { kind: "unaligned-reading", text: "11区不", reading: "11 Qu1 bu4" },
    });
  });

  it("accepts an unaligned reading without 一 or 不", () => {
    expectSpoken([["11区", "11 Qu1"]], ["11 Qu1"]);
  });
});
