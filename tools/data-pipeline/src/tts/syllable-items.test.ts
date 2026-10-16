import { describe, expect, it } from "vitest";
import { chartPairs, charReadings, seedCandidates, syllableItems } from "./syllable-items.ts";

describe("chartPairs", () => {
  it("lists every chart syllable in tones 1 to 4, ü written u:", () => {
    const pairs = chartPairs();
    expect(pairs.ok).toBe(true);
    const keys = new Set(pairs.ok ? pairs.value : []);
    for (const key of ["ba1", "ba4", "lu:4", "nu:e4", "zhi1", "yu2", "er4"]) {
      expect(keys.has(key), key).toBe(true);
    }
    expect(keys.has("ba5")).toBe(false);
    expect(keys.has("biang2")).toBe(false);
  });
});

describe("charReadings", () => {
  it("joins words, lowercases surnames and leaves a word's neutral tone out", () => {
    const readings = charReadings([
      ["钥", "鑰", "yue4"],
      ["钥匙", "鑰匙", "yao4 shi5"],
      ["单", "單", "dan1"],
      ["单", "單", "Shan4"],
      ["吗", "嗎", "ma5"],
      ["女", "女", "nu:3"],
      ["一点儿", "一點兒", "yi1 dian3 r5"],
    ]);
    expect([...(readings.get("钥") ?? [])]).toEqual(["yue4", "yao4"]);
    expect([...(readings.get("单") ?? [])]).toEqual(["dan1", "shan4"]);
    expect([...(readings.get("匙") ?? [])]).toEqual([]);
    expect([...(readings.get("吗") ?? [])]).toEqual(["ma5"]);
    expect([...(readings.get("女") ?? [])]).toEqual(["nu:3"]);
    expect(readings.has("儿")).toBe(false);
  });
});

describe("syllableItems", () => {
  const readings = new Map([
    ["八", new Set(["ba1"])],
    ["捌", new Set(["ba1"])],
    ["拔", new Set(["ba2"])],
    ["跋", new Set(["ba2"])],
    ["把", new Set(["ba3", "ba4"])],
    ["爸", new Set(["ba4"])],
    ["好", new Set(["hao3", "hao4"])],
    ["𰻞", new Set(["biang2"])],
  ]);
  const frequency = new Map([
    ["八", 5.5],
    ["拔", 3.9],
    ["爸", 4.6],
  ]);

  it("reuses a word pack recording, else the most frequent one-reading character, else a gap", () => {
    const { items, gaps } = syllableItems({
      pairs: ["ba1", "ba2", "ba3", "ba4", "hao3", "fo1"],
      readings,
      frequency,
      shipped: [
        { word: "好", reading: "hao3" },
        { word: "爸爸", reading: "ba4 ba5" },
      ],
    });
    expect(items).toEqual([
      { word: "八", reading: "ba1" },
      { word: "拔", reading: "ba2" },
      { word: "爸", reading: "ba4" },
      { word: "好", reading: "hao3" },
    ]);
    expect(gaps).toEqual([{ word: "", reading: "ba3", reason: "no-character" }]);
  });

  it("breaks a frequency tie by code point, so a rare character from the basic plane comes first", () => {
    const { items } = syllableItems({
      pairs: ["biang2", "ba2"],
      readings: new Map([...readings, ["䟦", new Set(["biang2"])]]),
      frequency: new Map(),
      shipped: [],
    });
    expect(items).toEqual([
      { word: "䟦", reading: "biang2" },
      { word: "拔", reading: "ba2" },
    ]);
  });
});

describe("seedCandidates", () => {
  const readings = new Map([
    ["啊", new Set(["a5", "a1", "a2", "a3", "a4"])],
    ["阿", new Set(["a1", "e1"])],
    ["吖", new Set(["a1"])],
    ["锕", new Set(["a1"])],
    ["八", new Set(["ba1"])],
  ]);
  const frequency = new Map([
    ["啊", 5.2],
    ["阿", 4.8],
    ["吖", 1.5],
  ]);

  it("lists the most frequent characters read only as the syllable, in any tone, labelled with a tone 1 to 4", () => {
    expect(
      seedCandidates({ syllable: "a", readings, frequency, excluded: new Set(), limit: 2 }),
    ).toEqual([
      { word: "啊", reading: "a1" },
      { word: "吖", reading: "a1" },
    ]);
  });

  it("leaves out the characters already recorded", () => {
    expect(
      seedCandidates({
        syllable: "a",
        readings,
        frequency,
        excluded: new Set(["啊", "吖"]),
        limit: 3,
      }),
    ).toEqual([{ word: "锕", reading: "a1" }]);
  });
});
