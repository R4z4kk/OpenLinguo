import { err, ok } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import type { ShardReader } from "../run.ts";
import { loadCharacters, planSlices, unicodeRange } from "./fonts.ts";

const code = (chars: string): number[] => Array.from(chars, (char) => char.codePointAt(0) ?? 0);

describe("unicodeRange", () => {
  it("merges consecutive code points", () => {
    expect(unicodeRange([0x20, 0x21, 0x22, 0x4e00, 0x4e2d, 0x4e2e])).toBe(
      "U+20-22,U+4e00,U+4e2d-4e2e",
    );
  });
});

describe("planSlices", () => {
  const covered = new Set([...code("ab我你好的是"), ...code("。")]);

  it("orders slices by HSK band and lists characters the font lacks", () => {
    const plan = planSlices(
      {
        levels: [
          ["我", "你"],
          ["好", "龘"],
        ],
        extras: ["我", "的"],
        others: ["是", "好", "𪚥"],
      },
      covered,
    );
    expect(
      plan.slices.map(({ name, codePoints }) => `${name}:${String.fromCodePoint(...codePoints)}`),
    ).toEqual(["latin:ab", "punctuation:。", "hsk-1:你我", "hsk-2:好", "gf0025:的", "more-01:是"]);
    expect(plan.missing).toEqual(["龘", "𪚥"]);
  });
});

describe("loadCharacters", () => {
  const shards: Record<string, readonly string[]> = {
    "hsk-2025-chars": [
      JSON.stringify([
        ["我", 1],
        ["好", 2],
      ]),
    ],
    "gf0025-2021-chars": [JSON.stringify([["的", 1]])],
    "cc-cedict": ['[["是是","是是","shi4",["yes"]],["的","的","de5",["of"]]]'],
    cfdict: ["[]"],
    "wiktionary-fr-zh": ["[]"],
    makemeahanzi: ["[]"],
    "hsk-2025-words": ["[]"],
    "gf0025-2021-words": ["[]"],
  };
  const reader: ShardReader = (dataset) => Promise.resolve(ok(shards[dataset] ?? []));

  it("reads the bands, the GF0025 list and dataset characters by frequency", async () => {
    const characters = await loadCharacters(reader);
    if (!characters.ok) throw new Error(characters.error);
    expect(characters.value.levels.slice(0, 2)).toEqual([["我"], ["好"]]);
    expect(characters.value.extras).toEqual(["的"]);
    expect(characters.value.others).toEqual(["是", "的"]);
  });

  it("requires the datasets to be built first", async () => {
    expect(await loadCharacters(() => Promise.resolve(ok([])))).toEqual(
      err("hsk-2025-chars must be built before the fonts"),
    );
  });
});
