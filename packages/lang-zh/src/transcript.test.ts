import { describe, expect, it } from "vitest";
import { alignChars, readingChars, type SpokenChar } from "./transcript.ts";

const spoken = (char: string, ...syllables: string[]): SpokenChar => ({
  char,
  syllables: new Set(syllables),
});

describe("readingChars", () => {
  it("pairs each character with its syllable, tones aside", () => {
    expect(readingChars("上学", "shang4 xue2")).toEqual([
      spoken("上", "shang"),
      spoken("学", "xue"),
    ]);
  });

  it("reads 儿 as er and normalizes ü", () => {
    expect(readingChars("一点儿", "yi1 dian3 r5")?.[2]).toEqual(spoken("儿", "er"));
    expect(readingChars("绿", "lu:4")).toEqual([spoken("绿", "lü")]);
  });

  it("refuses a reading that does not pair with the characters", () => {
    expect(readingChars("上学", "shang4")).toBeNull();
    expect(readingChars("A", "A")).toBeNull();
  });
});

describe("alignChars", () => {
  const expected = [spoken("上", "shang"), spoken("学", "xue")];

  it("matches the same characters", () => {
    expect(alignChars(expected, expected).map(({ kind }) => kind)).toEqual(["same", "same"]);
  });

  it("tells a homophone from another character", () => {
    const heard = [spoken("尚", "shang"), spoken("鞋", "xie")];
    expect(alignChars(expected, heard).map(({ kind }) => kind)).toEqual(["homophone", "different"]);
  });

  it("finds missing and extra characters", () => {
    expect(alignChars(expected, [spoken("学", "xue")]).map(({ kind }) => kind)).toEqual([
      "missing",
      "same",
    ]);
    const heard = [spoken("上", "shang"), spoken("学", "xue"), spoken("了", "le", "liao")];
    expect(alignChars(expected, heard).map(({ kind }) => kind)).toEqual(["same", "same", "extra"]);
  });

  it("lines a homophone up rather than a gap", () => {
    const heard = [spoken("嗯", "en"), spoken("尚", "shang"), spoken("学", "xue")];
    expect(alignChars(expected, heard).map(({ kind }) => kind)).toEqual([
      "extra",
      "homophone",
      "same",
    ]);
  });

  it("handles empty sides", () => {
    expect(alignChars([], [])).toEqual([]);
    expect(alignChars(expected, []).map(({ kind }) => kind)).toEqual(["missing", "missing"]);
    expect(alignChars([], expected).map(({ kind }) => kind)).toEqual(["extra", "extra"]);
  });
});
