import { ok } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import type { ShardReader } from "../run.ts";
import type { Candidate } from "./graded.ts";
import { hsk2025Chars, hsk2025Words, resolveReadings } from "./hsk-2025.ts";

const candidates = (...readings: string[]): Candidate[] =>
  readings.map((reading) => ({ key: reading.toLowerCase(), reading }));

describe("resolveReadings", () => {
  it("keeps the only reading of a word whatever the syllabus pinyin", () => {
    expect(resolveReadings("下雨", "xià", candidates("xia4 yu3"))).toEqual({
      keys: ["xia4 yu3"],
      issue: null,
    });
  });

  it("picks the reading whose tones match the syllabus", () => {
    expect(resolveReadings("东西", "dōngxi", candidates("dong1 xi1", "dong1 xi5"))).toEqual({
      keys: ["dong1 xi5"],
      issue: null,
    });
    expect(resolveReadings("中国", "Zhōngguó", candidates("Zhong1 guo2", "zhong4 guo2"))).toEqual({
      keys: ["zhong1 guo2"],
      issue: null,
    });
  });

  it("tolerates 一 and 不 sandhi", () => {
    expect(resolveReadings("一下", "yíxià", candidates("yi1 xia4", "yi1 xia5"))).toEqual({
      keys: ["yi1 xia4"],
      issue: null,
    });
  });

  it("prefers the reading needing the fewest neutral-tone tolerances", () => {
    expect(resolveReadings("起来", "qǐlái", candidates("qi3 lai5", "qi5 lai5"))).toEqual({
      keys: ["qi3 lai5"],
      issue: null,
    });
  });

  it("keeps every candidate and reports when the tones cannot decide", () => {
    expect(resolveReadings("为", "wei", candidates("wei2", "wei4"))).toEqual({
      keys: ["wei2", "wei4"],
      issue: "tone-ambiguous",
    });
  });

  it("keeps every candidate and reports an unusable pinyin", () => {
    expect(resolveReadings("嗯", "ǹg", candidates("en1", "en4"))).toEqual({
      keys: ["en1", "en4"],
      issue: "pinyin-unusable",
    });
  });

  it("reports a word absent from the dictionary", () => {
    expect(resolveReadings("口哨儿", "kǒushàor", [])).toEqual({ keys: [], issue: "absent" });
  });
});

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const syntheticCharacters = (counts: readonly number[]): string[] => {
  let codePoint = 0x4e00;
  return counts.flatMap((count, index) =>
    Array.from(
      { length: count },
      () => `${String.fromCodePoint(codePoint++)}\t${String(index + 1)}`,
    ),
  );
};

describe("hsk-2025-chars", () => {
  const counts = [246, 125, 284, 441, 431, 413, 1148];

  it("accepts the published per-level counts", async () => {
    const built = await hsk2025Chars.build(
      encode(["character\tlevel", ...syntheticCharacters(counts)].join("\n")),
      () => Promise.resolve(ok([])),
    );
    expect(built.ok && built.value.summary).toBe(
      "3088 recognition characters (246 / 125 / 284 / 441 / 431 / 413 / 1148)",
    );
  });

  it("fails when a level count differs", async () => {
    const rows = syntheticCharacters(counts).slice(1);
    const built = await hsk2025Chars.build(encode(["character\tlevel", ...rows].join("\n")), () =>
      Promise.resolve(ok([])),
    );
    expect(built.ok).toBe(false);
  });

  it("fails on a duplicate character or an unknown level", async () => {
    const build = (rows: readonly string[]) =>
      hsk2025Chars.build(encode(["character\tlevel", ...rows].join("\n")), () =>
        Promise.resolve(ok([])),
      );
    expect((await build(["一\t1", "一\t1"])).ok).toBe(false);
    expect((await build(["一\t8"])).ok).toBe(false);
  });
});

describe("hsk-2025-words", () => {
  const cedict: ShardReader = () =>
    Promise.resolve(
      ok([
        JSON.stringify([
          ["东西", "東西", "dong1 xi1", ["east and west"]],
          ["东西", "東西", "dong1 xi5", ["thing"]],
        ]),
      ]),
    );
  const filler = (count: number): string[] =>
    Array.from({ length: count }, (_, index) => `词${String(index)}\t7\t\tcí\t`);
  const header = "word\tlevel\talso\tpinyin\tpos";

  it("resolves readings and keeps the lowest level with the other ones", async () => {
    const rows = [header, "东西\t1\t4\tdōngxi\t名", ...filler(10_895)];
    const built = await hsk2025Words.build(encode(rows.join("\n")), cedict);
    if (!built.ok) throw new Error(built.error);
    expect(String(built.value.files.get("words-000.json")).split("\n")[1]).toBe(
      '["东西",1,[4],["dong1 xi5"]],',
    );
    expect(String(built.value.files.get("issues.tsv")).split("\n")[1]).toBe("词0\tcí\t\tabsent");
  });

  it("fails when the distinct word count differs from the transcription", async () => {
    const built = await hsk2025Words.build(encode([header, ...filler(10)].join("\n")), cedict);
    expect(built.ok).toBe(false);
  });

  it("fails when another level is not above the lowest one", async () => {
    const rows = [header, "东西\t4\t1\tdōngxi\t名", ...filler(10_895)];
    expect((await hsk2025Words.build(encode(rows.join("\n")), cedict)).ok).toBe(false);
  });
});
