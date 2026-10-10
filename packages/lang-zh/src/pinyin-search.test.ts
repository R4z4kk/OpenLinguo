import { describe, expect, it } from "vitest";
import { matchesPinyin, parsePinyinQuery, searchKey } from "./pinyin-search.ts";

describe("searchKey", () => {
  it.each([
    ["dian4 hua4", "dianhua"],
    ["Bei3 jing1", "beijing"],
    ["nu:3 er2", "nver"],
    ["lü4", "lv"],
    ["ê1", "e"],
    ["A A zhi4", "aazhi"],
    ["yi1 ge5 tian1 nan2 , yi1 ge5", "yigetiannanyige"],
  ])("%s → %s", (reading, key) => {
    expect(searchKey(reading)).toBe(key);
  });
});

describe("parsePinyinQuery", () => {
  it("reads pinyin without tones, with or without separators", () => {
    expect(parsePinyinQuery("dianhua")).toEqual({ key: "dianhua", tones: [], breaks: [] });
    expect(parsePinyinQuery(" Dian  hua")).toEqual({ key: "dianhua", tones: [], breaks: [3] });
    expect(parsePinyinQuery("xi'an")).toEqual({ key: "xian", tones: [], breaks: [1] });
    expect(parsePinyinQuery("mā ma-")).toEqual({
      key: "mama",
      tones: [{ at: 1, tone: 1, boundary: false }],
      breaks: [1, 3],
    });
  });

  it("reads tone marks inside their syllable", () => {
    expect(parsePinyinQuery("diànhuà")).toEqual({
      key: "dianhua",
      tones: [
        { at: 2, tone: 4, boundary: false },
        { at: 6, tone: 4, boundary: false },
      ],
      breaks: [],
    });
  });

  it("reads tone numbers at the end of their syllable, 0 and 5 as the neutral tone", () => {
    expect(parsePinyinQuery("dian4 hua4")).toEqual({
      key: "dianhua",
      tones: [
        { at: 3, tone: 4, boundary: true },
        { at: 6, tone: 4, boundary: true },
      ],
      breaks: [3],
    });
    expect(parsePinyinQuery("ma0")?.tones).toEqual([{ at: 1, tone: 5, boundary: true }]);
    expect(parsePinyinQuery("ma5")?.tones).toEqual([{ at: 1, tone: 5, boundary: true }]);
  });

  it("writes ü as v however it is typed", () => {
    for (const query of ["nü", "nv", "nu:", "NÜ"]) {
      expect(parsePinyinQuery(query)).toEqual({ key: "nv", tones: [], breaks: [] });
    }
    expect(parsePinyinQuery("nǚ")).toEqual({
      key: "nv",
      tones: [{ at: 1, tone: 3, boundary: false }],
      breaks: [],
    });
    expect(parsePinyinQuery("lu:4")).toEqual({
      key: "lv",
      tones: [{ at: 1, tone: 4, boundary: true }],
      breaks: [],
    });
  });

  it.each(["电话", "ma33", "4ma", "mā4", "hello!", "", " ", "ma6"])("rejects %j", (query) => {
    expect(parsePinyinQuery(query)).toBeNull();
  });
});

describe("matchesPinyin", () => {
  const query = (text: string) => {
    const parsed = parsePinyinQuery(text);
    if (parsed === null) throw new Error(`not pinyin: ${text}`);
    return parsed;
  };

  it("accepts any reading when the query has no tone or break", () => {
    expect(matchesPinyin("dian4 hua4", query("dianhua"))).toBe(true);
  });

  it("checks each typed tone against its syllable", () => {
    expect(matchesPinyin("dian4 hua4", query("diànhuà"))).toBe(true);
    expect(matchesPinyin("dian4 hua4", query("dian4hua"))).toBe(true);
    expect(matchesPinyin("dian1 hua4", query("diànhuà"))).toBe(false);
    expect(matchesPinyin("ma1 ma5", query("mama5"))).toBe(true);
    expect(matchesPinyin("ma1 ma1", query("mama5"))).toBe(false);
    expect(matchesPinyin("nu:3 er2", query("nǚ"))).toBe(true);
  });

  it("accepts a tone number only at the end of a syllable", () => {
    expect(matchesPinyin("xi1 an1", query("xi1an"))).toBe(true);
    expect(matchesPinyin("xian1", query("xi1an"))).toBe(false);
  });

  it("ends a syllable where the query has a space, an apostrophe or a hyphen", () => {
    expect(matchesPinyin("Xi1 an1", query("xi'an"))).toBe(true);
    expect(matchesPinyin("xian1", query("xi'an"))).toBe(false);
    expect(matchesPinyin("xian1", query("xian"))).toBe(true);
    expect(matchesPinyin("dian4 hua4", query("dian hua"))).toBe(true);
    expect(matchesPinyin("dian4 hua4", query("di anhua"))).toBe(false);
  });

  it("checks typed tones on a prefix of the reading", () => {
    expect(matchesPinyin("dian4 hua4", query("dian4"))).toBe(true);
    expect(matchesPinyin("dian4 hua4 hao4 ma3", query("diành"))).toBe(true);
  });

  it("rejects tones on letters that are not a syllable", () => {
    expect(matchesPinyin("A A zhi4", query("a1"))).toBe(false);
  });
});
