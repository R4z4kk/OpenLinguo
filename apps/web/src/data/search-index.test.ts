import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.ts";
import { idsFor, indexRecord, loadSearchIndex } from "./search-index.ts";

const entries = [
  {
    id: "电话\tdian4 hua4",
    reading: "dian4 hua4",
    glosses: [["telephone", "phone call"], ["téléphone"], []],
  },
  { id: "电\tdian4", reading: "dian4", glosses: [["electricity"], [], []] },
  { id: "女\tnu:3", reading: "nu:3", glosses: [["woman"], ["femme"], []] },
];

describe("indexRecord", () => {
  it("lists each key once per entry, keys sorted", () => {
    expect(indexRecord("sha", entries)).toEqual({
      file: "sha",
      ids: ["电话\tdian4 hua4", "电\tdian4", "女\tnu:3"],
      pinyin: [
        ["dian", [1]],
        ["dianhua", [0]],
        ["nv", [2]],
      ],
      words: [
        ["call", [0]],
        ["electricity", [1]],
        ["femme", [2]],
        ["phone", [0]],
        ["telephone", [0]],
        ["woman", [2]],
      ],
    });
  });
});

describe("loadSearchIndex", () => {
  it("merges the records of every file and finds keys or prefixes", async () => {
    const db = openDatabase("search-index-test");
    await db.searchIndex.bulkPut([
      indexRecord("a", entries.slice(0, 2)),
      indexRecord("b", [
        ...entries.slice(2),
        { id: "店\tdian4", reading: "dian4", glosses: [["shop"], [], []] },
      ]),
    ]);
    await db.meta.put({ key: "dataVersion", value: "v1" });
    const index = await loadSearchIndex(db);
    expect(index.pinyin.keys).toEqual(["dian", "dianhua", "nv"]);
    expect(idsFor(index.pinyin, "dian", false)).toEqual(new Set(["电\tdian4", "店\tdian4"]));
    expect(idsFor(index.pinyin, "dian", true)).toEqual(
      new Set(["电\tdian4", "店\tdian4", "电话\tdian4 hua4"]),
    );
    expect(idsFor(index.words, "tele", true)).toEqual(new Set(["电话\tdian4 hua4"]));
    expect(idsFor(index.words, "tele", false)).toEqual(new Set());
    expect(idsFor(index.words, "zzz", true)).toEqual(new Set());
    expect(await loadSearchIndex(db)).toBe(index);
  });

  it("fails before the data is imported", async () => {
    await expect(loadSearchIndex(openDatabase("search-index-empty-test"))).rejects.toThrow(
      "the dictionary is not imported",
    );
  });
});
