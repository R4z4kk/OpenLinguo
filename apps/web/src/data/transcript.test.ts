import { inMemoryDictionary, ok, type DictEntry } from "@openlinguo/core";
import { createZhPack } from "@openlinguo/lang-zh";
import { describe, expect, it } from "vitest";
import { readText, sameShare, toSimplified } from "./transcript.ts";

const entry = (headword: string, reading: string, variants: string[] = []): DictEntry => ({
  headword,
  variants,
  reading,
  glosses: [],
  level: null,
});

const entries = [
  entry("我们", "wo3 men5", ["我們"]),
  entry("吃饭", "chi1 fan4", ["吃飯"]),
  entry("了", "le5"),
  entry("了", "liao3"),
  entry("二", "er4"),
  entry("行", "xing2"),
  entry("行", "hang2"),
  entry("银行", "yin2 hang2"),
];
const pack = createZhPack({
  lookup: inMemoryDictionary(entries),
  lexicon: new Set(entries.map(({ headword }) => headword)),
  proficiency: "hsk-2025",
  decompositions: new Map(),
  strokesOf: () => Promise.resolve(ok(null)),
  wordsOfPinyin: () => Promise.resolve(ok([])),
});

describe("toSimplified", () => {
  it("converts traditional characters", () => {
    expect(toSimplified("我們一起去吃飯吧")).toBe("我们一起去吃饭吧");
  });
});

describe("readText", () => {
  it("reads each character in its word, with the word's reading", async () => {
    const read = await readText(pack, "我们吃饭了。");
    expect(read.ok && read.value.map(({ char, reading }) => `${char}:${String(reading)}`)).toEqual([
      "我:wo3",
      "们:men5",
      "吃:chi1",
      "饭:fan4",
      "了:le5",
    ]);
    expect(read.ok && [...(read.value[4]?.syllables ?? [])]).toEqual(["le", "liao"]);
  });

  it("keeps a polyphone's reading in its word, every reading alone", async () => {
    const read = await readText(pack, "银行行");
    expect(read.ok && read.value.map(({ syllables }) => [...syllables])).toEqual([
      ["yin"],
      ["hang"],
      ["xing", "hang"],
    ]);
  });

  it("reads digits as characters and keeps other letters as one item", async () => {
    const read = await readText(pack, "2 See");
    expect(read.ok && read.value.map(({ char }) => char)).toEqual(["二", "See"]);
    expect(read.ok && read.value[1]?.syllables.size).toBe(0);
  });
});

describe("sameShare", () => {
  it("counts the expected characters heard as such, traditional ones converted", () => {
    expect(sameShare("我们一起去吃饭吧", "我們一起去吃飯吧。")).toBe(1);
    expect(sameShare("我们一起去吃饭吧", "我们一起去吃")).toBe(0.75);
    expect(sameShare("我们一起去吃饭吧", "很快被環码裝備的警察")).toBe(0);
    expect(sameShare("", "我们")).toBe(0);
  });
});
