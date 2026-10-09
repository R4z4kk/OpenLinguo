import { ok } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { entryForms, gf0025Chars, gf0025Words, parseNumberedList } from "./gf0025-2021.ts";

const list = (sections: readonly (readonly [string, readonly string[]])[]): string =>
  [
    "# header",
    ...sections.flatMap(([title, items]) => [
      title,
      ...items.map((item, index) => `${String(index + 1)} ${item}`),
    ]),
  ].join("\n");

describe("parseNumberedList", () => {
  it("groups numbered items under the expected sections", () => {
    const text = list([
      ["A", ["爱", "八"]],
      ["B", ["吃"]],
    ]);
    expect(parseNumberedList(text, ["A", "B"], [2, 1])).toEqual(
      ok({
        items: [
          { section: 0, text: "爱" },
          { section: 0, text: "八" },
          { section: 1, text: "吃" },
        ],
        repairs: [],
      }),
    );
  });

  it("accepts and lists an OCR-misread number when the sequence continues", () => {
    const text = ["A", "1 火焰", "5 火药", "3 伙食"].join("\n");
    const parsed = parseNumberedList(text, ["A"], [3]);
    expect(parsed.ok && parsed.value.repairs).toEqual(["A\t5 火药\tread as 2"]);
  });

  it("fails on any other numbering break", () => {
    expect(parseNumberedList(["A", "1 爱", "3 八", "4 吃"].join("\n"), ["A"], [3]).ok).toBe(false);
  });

  it("fails when a section count differs from the standard", () => {
    expect(parseNumberedList(list([["A", ["爱"]]]), ["A"], [2]).ok).toBe(false);
  });

  it("fails on a missing or unexpected section", () => {
    expect(parseNumberedList(list([["A", ["爱"]]]), ["A", "B"], [1, 0]).ok).toBe(false);
    expect(parseNumberedList(["X", "1 爱"].join("\n"), ["A"], [1]).ok).toBe(false);
  });
});

describe("entryForms", () => {
  it.each([
    ["爸爸｜爸", ["爸爸", "爸"]],
    ["称¹（动）", ["称"]],
    ["多（形、代）", ["多"]],
    ["第（第二）", ["第"]],
    ["…极了", ["极了"]],
    ["零｜〇", ["零", "〇"]],
  ])("%s → %j", (entry, forms) => {
    expect(entryForms(entry)).toEqual(forms);
  });
});

const bands = ["一", "二", "三", "四", "五", "六", "七一九"];

const syntheticItems = (count: number, start: number): string[] =>
  Array.from({ length: count }, (_, index) => String.fromCodePoint(start + index));

describe("gf0025-2021 datasets", () => {
  it("builds recognition characters when every count matches the standard", async () => {
    let next = 0x4e00;
    const sections = [
      ...bands.map((band, index) => [`${band}级汉字表`, index < 6 ? 300 : 1200] as const),
      ...["初等", "中等", "高等"].map(
        (band, index) => [`${band}手写字表`, [300, 400, 500][index] ?? 0] as const,
      ),
    ].map(([title, count]) => {
      const items = syntheticItems(count, next);
      next += count;
      return [title, items] as const;
    });
    const built = await gf0025Chars.build(new TextEncoder().encode(list(sections)), () =>
      Promise.resolve(ok([])),
    );
    expect(built.ok && built.value.summary).toBe(
      "3000 recognition characters (300 / 300 / 300 / 300 / 300 / 300 / 1200), 0 numbering repairs",
    );
  });

  it("keeps the lowest level of a word listed twice and every reading of a polyphone", async () => {
    const counts = [500, 772, 973, 1000, 1071, 1140, 5636];
    let next = 0x4e00;
    const sections = bands.map((band, index) => {
      const items = syntheticItems(counts[index] ?? 0, next);
      next += counts[index] ?? 0;
      if (index === 0) items[0] = "东西";
      if (index === 3) items[0] = "东西";
      return [`${band}级词汇表`, items] as const;
    });
    const cedict = JSON.stringify([
      ["东西", "東西", "dong1 xi1", ["east and west"]],
      ["东西", "東西", "dong1 xi5", ["thing"]],
    ]);
    const built = await gf0025Words.build(new TextEncoder().encode(list(sections)), () =>
      Promise.resolve(ok([cedict])),
    );
    if (!built.ok) throw new Error(built.error);
    expect(String(built.value.files.get("words-000.json")).split("\n")[1]).toBe(
      '["东西",1,[4],["dong1 xi1","dong1 xi5"]],',
    );
    expect(String(built.value.files.get("issues.tsv")).split("\n")[1]).toBe(
      "东西\tdong1 xi1 | dong1 xi5\tpolyphone-without-pinyin",
    );
  });
});
