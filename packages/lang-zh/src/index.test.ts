import { inMemoryDictionary, ok, type DictEntry, type StrokeData } from "@openlinguo/core";
import { describeLanguagePackContract } from "@openlinguo/core/testing";
import { describe, expect, it } from "vitest";
import { createZhPack } from "./index.ts";

const fixture: readonly DictEntry[] = [
  {
    headword: "电话",
    variants: ["電話"],
    reading: "dian4 hua4",
    glosses: [
      { lang: "en", text: "telephone", source: "cc-cedict" },
      { lang: "fr", text: "téléphone", source: "cfdict" },
    ],
    level: null,
  },
];

const strokes: ReadonlyMap<string, StrokeData> = new Map([
  [
    "电",
    {
      strokes: ["M 0 0 Z"],
      medians: [
        [
          [0, 0],
          [10, 10],
        ],
      ],
    },
  ],
]);
const strokesOf = (character: string) => Promise.resolve(ok(strokes.get(character) ?? null));

describeLanguagePackContract(
  () =>
    createZhPack({
      lookup: inMemoryDictionary(fixture),
      lexicon: new Set(fixture.map((entry) => entry.headword)),
      decompositions: new Map([["电", "⿻曰乚"]]),
      proficiency: "hsk-2025",
      strokesOf,
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
      decompositions: new Map(),
      proficiency: "gf0025-2021",
      strokesOf,
    });
    expect(pack.proficiency).toBe("gf0025-2021");
  });
});
