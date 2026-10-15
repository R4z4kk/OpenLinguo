import { describe, expect, it } from "vitest";
import { charSyllables, charTones, heardToneMatches, transcriptMatches } from "./asr-check.ts";

const chars = charSyllables([
  ["一", "一", "yi1"],
  ["个", "個", "ge4"],
  ["马", "馬", "ma3"],
  ["吗", "嗎", "ma5"],
  ["妈", "媽", "ma1"],
  ["女", "女", "nu:3"],
  ["点", "點", "dian3"],
  ["儿", "兒", "er2"],
  ["儿", "兒", "r5"],
  ["一个", "一個", "yi1 ge4"],
]);

describe("transcriptMatches", () => {
  it("accepts the same characters, punctuation aside", () => {
    expect(transcriptMatches(chars, "yi1 ge5", "一个。")).toBe(true);
  });

  it("accepts homophones, traditional forms and digits", () => {
    expect(transcriptMatches(chars, "ma3", "吗")).toBe(true);
    expect(transcriptMatches(chars, "yi1 ge5", "1個")).toBe(true);
    expect(transcriptMatches(chars, "nu:3", "女")).toBe(true);
    expect(transcriptMatches(chars, "yi1 dian3 r5", "一点儿")).toBe(true);
  });

  it("accepts erhua written without its 儿", () => {
    expect(transcriptMatches(chars, "yi1 dian3 r5", "一点")).toBe(true);
    expect(transcriptMatches(chars, "yi1 dian3", "一点儿")).toBe(false);
  });

  it("refuses an added or missing word", () => {
    expect(transcriptMatches(chars, "ma1", "妈妈")).toBe(false);
    expect(transcriptMatches(chars, "yi1 ge5", "一")).toBe(false);
    expect(transcriptMatches(chars, "yi1 ge5", "")).toBe(false);
  });

  it("counts other letters as a word", () => {
    expect(transcriptMatches(chars, "ma3", "a吗")).toBe(false);
    expect(transcriptMatches(chars, "ma3", "town")).toBe(false);
  });

  it("reads a character as it is read in words", () => {
    const words = charSyllables([
      ["钥", "鑰", "yue4"],
      ["匙", "匙", "shi5"],
      ["钥匙", "鑰匙", "yao4 shi5"],
    ]);
    expect(transcriptMatches(words, "yao4 shi5", "钥匙")).toBe(true);
  });

  it("tells whether the character heard for a syllable can carry its tone", () => {
    const tones = charTones([
      ["马", "馬", "ma3"],
      ["妈", "媽", "ma1"],
      ["吗", "嗎", "ma5"],
    ]);
    expect(heardToneMatches(tones, "ma3", "马。")).toBe(true);
    expect(heardToneMatches(tones, "ma3", "妈")).toBe(false);
    expect(heardToneMatches(tones, "ma5", "妈")).toBe(true);
  });

  it("refuses another syllable", () => {
    expect(transcriptMatches(chars, "ma1", "点")).toBe(false);
  });
});
