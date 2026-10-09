import { describe, expect, it } from "vitest";
import { joinedToNumbered, readingKey, toDiacritic, toNumbered, tonesOf } from "./pinyin.ts";

const golden: readonly (readonly [numbered: string, diacritic: string])[] = [
  ["dian4 hua4", "diàn huà"],
  ["ma1 ma5", "mā ma"],
  ["lu:4", "lǜ"],
  ["nu:3 er2", "nǚ ér"],
  ["lu:e4", "lüè"],
  ["Bei3 jing1", "Běi jīng"],
  ["Ou1 zhou1", "Ōu zhōu"],
  ["xiu1 xi5", "xiū xi"],
  ["gui4", "guì"],
  ["zhuang4", "zhuàng"],
  ["lou2", "lóu"],
  ["xue2", "xué"],
  ["er4", "èr"],
  ["ng2", "ńg"],
  ["m2", "ḿ"],
  ["hm5", "hm"],
  ["yi1 xia4 r5", "yī xià r"],
  ["san1 D da3 yin4", "sān D dǎ yìn"],
  ["da3 call", "dǎ call"],
  ["yi1 ge5 tian1 nan2 , yi1 ge5", "yī ge tiān nán , yī ge"],
];

describe("toDiacritic", () => {
  it.each(golden)("%s → %s", (numbered, diacritic) => {
    expect(toDiacritic(numbered)).toEqual({ ok: true, value: diacritic });
  });

  it("accepts v for ü", () => {
    expect(toDiacritic("nv3")).toEqual({ ok: true, value: "nǚ" });
  });

  it.each(["dain4", "xx5", "ma0", "ma6", "", "dian4  hua4", "r4"])("rejects %j", (reading) => {
    expect(toDiacritic(reading)).toEqual({
      ok: false,
      error: { kind: "invalid-reading", reading },
    });
  });
});

describe("toNumbered", () => {
  it.each(golden)("%s ← %s", (numbered, diacritic) => {
    expect(toNumbered(diacritic)).toEqual({ ok: true, value: numbered });
  });

  it("reads an unmarked syllable as neutral tone", () => {
    expect(toNumbered("ma")).toEqual({ ok: true, value: "ma5" });
  });

  it.each(["xǐàn", "dǎà", "", "D̀"])("rejects %j", (text) => {
    expect(toNumbered(text).ok).toBe(false);
  });
});

describe("tonesOf", () => {
  it("returns one tone per token, null for non-syllables", () => {
    expect(tonesOf("san1 D da3 yin4")).toEqual({ ok: true, value: [1, null, 3, 4] });
  });

  it("propagates invalid readings", () => {
    expect(tonesOf("dain4").ok).toBe(false);
  });
});

describe("readingKey", () => {
  it.each([
    ["Bei3 jing1", "bei3 jing1"],
    ["lu:4", "lu:4"],
    ["nv3", "nu:3"],
    ["lü4", "lu:4"],
    ["san1 D", "san1 d"],
  ])("%s → %s", (reading, key) => {
    expect(readingKey(reading)).toEqual({ ok: true, value: key });
  });

  it("rejects invalid readings", () => {
    expect(readingKey("dain4").ok).toBe(false);
  });
});

describe("joinedToNumbered", () => {
  it.each([
    ["diànhuà", 2, "dian4 hua4"],
    ["xīngqī", 2, "xing1 qi1"],
    ["dōngxi", 2, "dong1 xi5"],
    ["xī'ān", 2, "xi1 an1"],
    ["xiān", 1, "xian1"],
    ["nǚ'ér", 2, "nu:3 er2"],
    ["lüè", 1, "lu:e4"],
    ["Rìběn", 2, "Ri4 ben3"],
    ["yīhuìr", 3, "yi1 hui4 r5"],
    ["nǎr", 2, "na3 r5"],
    ["yī mǎ dāng xiān", 4, "yi1 ma3 dang1 xian1"],
    ["ǹg", 1, "ng4"],
  ])("%s (%i) → %s", (pinyin, syllables, numbered) => {
    expect(joinedToNumbered(pinyin, syllables)).toEqual({ ok: true, value: numbered });
  });

  it("follows the apostrophe rule of pinyin orthography", () => {
    expect(joinedToNumbered("fāngàn", 2)).toEqual({ ok: true, value: "fan1 gan4" });
    expect(joinedToNumbered("fāng'àn", 2)).toEqual({ ok: true, value: "fang1 an4" });
    expect(joinedToNumbered("xian", 2).ok).toBe(false);
  });

  it.each([
    ["diànhuà", 3],
    ["dianhuà1", 2],
    ["dǎà", 1],
    ["", 1],
  ])("rejects %j with %i syllables", (pinyin, syllables) => {
    expect(joinedToNumbered(pinyin, syllables).ok).toBe(false);
  });
});
