import { err } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { buildDictionary, type DictionarySources } from "./dictionary-pack.ts";

const sources: DictionarySources = {
  cedict: [
    ["俊", "㑺", "jun4", ["old variant of 俊[jun4]"]],
    ["俊", "俊", "jun4", ["smart", "eminent"]],
    ["华", "華", "Hua2", ["surname Hua"]],
    ["华", "華", "hua2", ["magnificent"]],
    ["々", "々", "xx5", ["ideographic iteration mark"]],
  ],
  frenchGlosses: [
    ["cfdict", [["俊", "jun4", ["beau", "talentueux"]]]],
    ["wiktionary-fr", [["俊", "jun4", ["beau"]]]],
  ],
  frenchOnly: [
    ["cfdict", [["天啊", "天啊", "tian1 a5", ["Mon Dieu !"]]]],
    ["wiktionary-fr", [["天啊", "天啊", "tian1 a5", ["Mon Dieu !", "Ciel !"]]]],
  ],
  hsk2025: [["俊", 6, [], ["jun4"]]],
  gf0025: [["华", 5, [], ["hua2"]]],
};

describe("buildDictionary", () => {
  it("merges readings, attaches French glosses and levels, and lists invalid rows", () => {
    const built = buildDictionary(sources);
    if (!built.ok) throw new Error(built.error);
    expect(built.value.entries).toEqual([
      [
        "俊",
        "jun4",
        "jun4",
        ["㑺"],
        [["old variant of 俊[jun4]", "smart", "eminent"], ["beau", "talentueux"], ["beau"]],
        6,
        null,
        true,
      ],
      ["华", "hua2", "hua2", ["華"], [["surname Hua", "magnificent"], [], []], null, 5, true],
      [
        "天啊",
        "tian1 a5",
        "tian1 a5",
        [],
        [[], ["Mon Dieu !"], ["Mon Dieu !", "Ciel !"]],
        null,
        null,
        false,
      ],
    ]);
    expect(built.value.lexicon).toEqual(["俊", "华"]);
    expect(built.value.skipped).toEqual([["々", "々", "xx5", ["ideographic iteration mark"]]]);
  });

  it("fails when a source points to a reading the dictionary lacks", () => {
    expect(buildDictionary({ ...sources, gf0025: [["俊", 1, [], ["jun3"]]] })).toEqual(
      err("gf0025 grades 俊 jun3, absent from the dictionary"),
    );
    expect(
      buildDictionary({ ...sources, frenchGlosses: [["cfdict", [["天啊", "tian1 a5", ["x"]]]]] }),
    ).toEqual(err("cfdict glosses 天啊 tian1 a5, absent from CC-CEDICT"));
  });
});
