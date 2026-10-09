import { describe, expect, it } from "vitest";
import { inMemoryDictionary, intlTokenizer } from "./dictionary.ts";
import type { DictEntry } from "./language-pack.ts";

const entry = (headword: string, variants: readonly string[]): DictEntry => ({
  headword,
  variants,
  reading: null,
  glosses: [{ lang: "en", text: headword, source: "test" }],
  level: null,
});

describe("inMemoryDictionary", () => {
  const lookup = inMemoryDictionary([entry("电话", ["電話"]), entry("电", ["電"])]);

  it("finds an entry by headword or variant", async () => {
    expect(await lookup("电话")).toEqual({ ok: true, value: [entry("电话", ["電話"])] });
    expect(await lookup("電話")).toEqual({ ok: true, value: [entry("电话", ["電話"])] });
  });

  it("indexes an entry once when its variant equals the headword", async () => {
    const same = inMemoryDictionary([entry("你", ["你"])]);
    const result = await same("你");
    expect(result.ok && result.value.length).toBe(1);
  });

  it("returns an empty list for an unknown term", async () => {
    expect(await lookup("话")).toEqual({ ok: true, value: [] });
  });
});

describe("intlTokenizer", () => {
  it("returns offsets and word flags", () => {
    expect(intlTokenizer("en")("Hi, you")).toEqual([
      { text: "Hi", start: 0, end: 2, isWord: true },
      { text: ",", start: 2, end: 3, isWord: false },
      { text: " ", start: 3, end: 4, isWord: false },
      { text: "you", start: 4, end: 7, isWord: true },
    ]);
  });
});
