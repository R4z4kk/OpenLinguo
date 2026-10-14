import { describe, expect, it } from "vitest";
import { bandItems, severalReadings, syllableCount, type WordLists } from "./pack-words.ts";

const lists: WordLists = {
  "hsk-2025": [
    ["一", 1, [], ["yi1"]],
    ["东西", 1, [], ["dong1 xi5"]],
    ["长", 2, [], ["chang2", "zhang3"]],
    ["㐀", 1, [], []],
  ],
  "gf0025-2021": [
    ["一", 1, [], ["yi1"]],
    ["东西", 2, [], ["dong1 xi1"]],
  ],
};

describe("audio pack words", () => {
  it("finds words with several readings across both referentials", () => {
    expect([...severalReadings(lists)].sort()).toEqual(["东西", "长"].sort());
  });

  it("keeps the band's single-reading words and lists the others as gaps", () => {
    const { items, gaps } = bandItems(
      lists,
      { referential: "hsk-2025", level: 1 },
      severalReadings(lists),
    );
    expect(items).toEqual([{ word: "一", reading: "yi1" }]);
    expect(gaps).toEqual([
      { word: "东西", reading: "dong1 xi5", reason: "several-readings" },
      { word: "㐀", reading: "", reason: "no-reading" },
    ]);
  });

  it("counts the syllables said, the erhua suffix being said inside the previous one", () => {
    expect(syllableCount({ word: "一", reading: "yi1" })).toBe(1);
    expect(syllableCount({ word: "东西", reading: "dong1 xi5" })).toBe(2);
    expect(syllableCount({ word: "一点儿", reading: "yi1 dian3 r5" })).toBe(2);
    expect(syllableCount({ word: "女儿", reading: "nu:3 er2" })).toBe(2);
  });
});
