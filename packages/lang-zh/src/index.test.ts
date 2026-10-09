import { inMemoryDictionary, type DictEntry } from "@openlinguo/core";
import { describeLanguagePackContract } from "@openlinguo/core/testing";
import { describe, expect, it } from "vitest";
import { createZhPack } from "./index.ts";

const fixture: readonly DictEntry[] = [
  {
    headword: "电话",
    variants: ["電話"],
    reading: "dian4 hua4",
    glosses: [
      { lang: "en", text: "telephone" },
      { lang: "fr", text: "téléphone" },
    ],
    level: null,
  },
];

describeLanguagePackContract(
  () =>
    createZhPack({
      lookup: inMemoryDictionary(fixture),
      lexicon: new Set(fixture.map((entry) => entry.headword)),
      proficiency: "hsk-2025",
    }),
  {
    knownTerm: "电话",
    unknownTerm: "龘",
    sampleText: "我想打电话给你。",
  },
);

describe("createZhPack", () => {
  it("uses the HSK referential it is given", () => {
    const pack = createZhPack({
      lookup: inMemoryDictionary(fixture),
      lexicon: new Set(),
      proficiency: "gf0025-2021",
    });
    expect(pack.proficiency).toBe("gf0025-2021");
  });
});
