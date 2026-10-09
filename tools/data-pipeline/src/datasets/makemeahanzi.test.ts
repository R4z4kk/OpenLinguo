import { err, ok } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { makemeahanzi, parseDictionary } from "./makemeahanzi.ts";

const line = (character: string, extra: object = {}): string =>
  JSON.stringify({
    character,
    definition: "definition",
    pinyin: ["mā"],
    decomposition: "⿰女马",
    radical: "女",
    matches: [[0], [0], [0], [1], [1], [1]],
    ...extra,
  });

const dictionary = [
  line("妈", {
    etymology: { type: "pictophonetic", phonetic: "马", semantic: "女", hint: "woman" },
  }),
  line("⺀", { decomposition: "？", radical: "⺀" }),
].join("\n");

describe("parseDictionary", () => {
  it("keeps decomposition, radical and etymology", () => {
    expect(parseDictionary(dictionary)).toEqual(
      ok([
        [
          "妈",
          "⿰女马",
          "女",
          { type: "pictophonetic", hint: "woman", phonetic: "马", semantic: "女" },
        ],
        ["⺀", "？", "⺀", null],
      ]),
    );
  });

  it("fills missing etymology fields with null", () => {
    const rows = parseDictionary(line("我", { etymology: { type: "ideographic" } }));
    expect(rows.ok && rows.value[0]?.[3]).toEqual({
      type: "ideographic",
      hint: null,
      phonetic: null,
      semantic: null,
    });
  });

  it("rejects malformed lines, several characters and unknown etymology types", () => {
    const text = [
      line("妈"),
      "{oops",
      line("妈妈"),
      line("我", { etymology: { type: "other" } }),
    ].join("\n");
    expect(parseDictionary(text)).toEqual(err("3 malformed lines (2, 3, 4)"));
  });

  it("rejects duplicate characters", () => {
    expect(parseDictionary(`${line("妈")}\n${line("妈")}`)).toEqual(err("1 duplicate characters"));
  });
});

describe("makemeahanzi dataset", () => {
  it("writes shards, the license texts and an attribution readme", async () => {
    const built = await makemeahanzi.build(new TextEncoder().encode(dictionary), () =>
      Promise.resolve(ok([])),
    );
    if (!built.ok) throw new Error(built.error);
    expect([...built.value.files.keys()].sort()).toEqual([
      "GPL-3.0.txt",
      "README.md",
      "characters-000.json",
      "makemeahanzi-LGPL",
    ]);
    expect(built.value.files.get("makemeahanzi-LGPL")).toContain(
      "GNU LESSER GENERAL PUBLIC LICENSE",
    );
    expect(built.value.files.get("GPL-3.0.txt")).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(built.value.summary).toBe("2 characters, 1 with an unknown component");
  });
});
