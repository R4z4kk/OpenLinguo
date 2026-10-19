import { err, inMemoryDictionary, ok, type DictEntry } from "@openlinguo/core";
import { createZhPack } from "@openlinguo/lang-zh";
import { describe, expect, it } from "vitest";
import { gradeTyping, typedReading } from "./typing-card.ts";

const entry = (headword: string, reading: string): DictEntry => ({
  headword,
  variants: [],
  reading,
  glosses: [],
  level: null,
});

const entries = [
  entry("电话", "dian4 hua4"),
  entry("点画", "dian3 hua4"),
  entry("行", "xing2"),
  entry("银行", "yin2 hang2"),
];
const zhPack = (lookup: Parameters<typeof createZhPack>[0]["lookup"]) =>
  createZhPack({
    lookup,
    lexicon: new Set(entries.map(({ headword }) => headword)),
    proficiency: "hsk-2025",
    decompositions: new Map(),
    strokesOf: () => Promise.resolve(ok(null)),
    wordsOfPinyin: () => Promise.resolve(ok([])),
  });
const pack = zhPack(inMemoryDictionary(entries));

describe("gradeTyping", () => {
  it("grades the headword typed exactly good", () => {
    expect(gradeTyping("电话", "电话")).toBe("good");
  });

  it("grades anything else again", () => {
    expect(gradeTyping("电话", "点画")).toBe("again");
    expect(gradeTyping("电话", "电")).toBe("again");
    expect(gradeTyping("电话", "")).toBe("again");
  });
});

describe("typedReading", () => {
  it("keeps the card's reading when the answer is right", async () => {
    expect(await typedReading(pack, { headword: "行", readingKey: "hang2" }, "行")).toEqual(
      ok("hang2"),
    );
  });

  it("reads a wrong answer from the dictionary", async () => {
    expect(
      await typedReading(pack, { headword: "电话", readingKey: "dian4 hua4" }, "点画"),
    ).toEqual(ok("dian3 hua4"));
  });

  it("gives no reading when nothing was typed or a character has none", async () => {
    const card = { headword: "电话", readingKey: "dian4 hua4" };
    expect(await typedReading(pack, card, "")).toEqual(ok(null));
    expect(await typedReading(pack, card, "龘")).toEqual(ok(null));
  });

  it("reports a dictionary that cannot be read", async () => {
    const failing = zhPack(() =>
      Promise.resolve(err({ kind: "storage-failure", message: "quota" })),
    );
    expect(
      await typedReading(failing, { headword: "电话", readingKey: "dian4 hua4" }, "点画"),
    ).toEqual(err({ kind: "storage-failure", message: "quota" }));
  });
});
