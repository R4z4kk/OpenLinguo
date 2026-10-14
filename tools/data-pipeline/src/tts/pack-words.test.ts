import { describe, expect, it } from "vitest";
import { bandItems, severalReadings, type WordLists } from "./pack-words.ts";

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
});
