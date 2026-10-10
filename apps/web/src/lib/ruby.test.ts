import { describe, expect, it } from "vitest";
import { rubyPairs } from "./ruby.ts";

describe("rubyPairs", () => {
  it("puts each syllable over its character", () => {
    expect(rubyPairs("电话", ["diàn", "huà"])).toEqual([
      ["电", ["diàn"]],
      ["话", ["huà"]],
    ]);
    expect(rubyPairs("𠮷野", ["jí", "yě"])).toEqual([
      ["𠮷", ["jí"]],
      ["野", ["yě"]],
    ]);
  });

  it("annotates the whole word when the syllables do not line up", () => {
    expect(rubyPairs("哪儿", ["nǎr"])).toEqual([["哪儿", ["nǎr"]]]);
  });
});
