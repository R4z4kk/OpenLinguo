import { err, inMemoryDictionary, type DictEntry, type PromptPack } from "@openlinguo/core";
import { beforeAll, describe, expect, it } from "vitest";
import { createReadingCheck } from "./reading-check.ts";
import { createSegmenter } from "./segment.ts";
import { loadCedictRows } from "./testing/dataset-shards.ts";

let check: PromptPack["checkReading"];

beforeAll(async () => {
  const rows = await loadCedictRows();
  const entries: DictEntry[] = rows.map(([simplified, traditional, reading]) => ({
    headword: simplified,
    variants: traditional === simplified ? [] : [traditional],
    reading,
    glosses: [],
    level: null,
  }));
  check = createReadingCheck(
    inMemoryDictionary(entries),
    createSegmenter(new Set(rows.map(([simplified]) => simplified))),
  );
});

const clean = { ok: true, value: [] };

describe("checkReading against CC-CEDICT", () => {
  it("accepts 了 as le after a verb and liǎo in 了解", async () => {
    expect(await check("我吃了饭。", "wǒ chī le fàn")).toEqual(clean);
    expect(await check("我了解他。", "wǒ liǎo jiě tā")).toEqual(clean);
  });

  it("flags le in 了解 with its position and the dictionary's readings, without fixing it", async () => {
    expect(await check("我了解他。", "wǒ le jiě tā")).toEqual({
      ok: true,
      value: [{ start: 1, end: 2, written: "le5", readings: ["liao3", "liao4"] }],
    });
  });

  it("flags a tone 了 never has", async () => {
    expect(await check("我吃了饭。", "wǒ chī lè fàn")).toEqual({
      ok: true,
      value: [{ start: 2, end: 3, written: "le4", readings: ["le5", "liao3", "liao4"] }],
    });
  });

  it("accepts 的 as de and as dí in 的确, and flags de in 的确", async () => {
    expect(await check("这是我的书。", "zhè shì wǒ de shū")).toEqual(clean);
    expect(await check("他的确很忙。", "tā díquè hěn máng")).toEqual(clean);
    expect(await check("他的确很忙。", "tā de què hěn máng")).toMatchObject({
      ok: true,
      value: [{ start: 1, end: 2, written: "de5" }],
    });
  });

  it("accepts 行 as xíng alone and háng in 银行, and flags xíng in 银行", async () => {
    expect(await check("你真行！", "nǐ zhēn xíng!")).toEqual(clean);
    expect(await check("我去银行。", "wǒ qù yín háng")).toEqual(clean);
    expect(await check("我去银行。", "wǒ qù yín xíng")).toEqual({
      ok: true,
      value: [{ start: 3, end: 4, written: "xing2", readings: ["hang2"] }],
    });
  });

  it("accepts a word's neutral tone and its character's own tone", async () => {
    expect(await check("他是我的朋友。", "tā shì wǒ de péngyou")).toEqual(clean);
    expect(await check("他是我的朋友。", "tā shì wǒ de péngyǒu")).toEqual(clean);
  });

  it("lets tone sandhi pass", async () => {
    expect(await check("不是", "bú shì")).toEqual(clean);
    expect(await check("一个人", "yí gè rén")).toEqual(clean);
    expect(await check("你好", "ní hǎo")).toEqual(clean);
  });

  it("flags a second tone that no third tone follows", async () => {
    expect(await check("你好", "nǐ háo")).toMatchObject({
      ok: true,
      value: [{ start: 1, end: 2, written: "hao2" }],
    });
  });

  it("splits joined, capitalized and punctuated pinyin", async () => {
    expect(await check("我想打电话给你。", "Wǒ xiǎng dǎ diànhuà gěi nǐ.")).toEqual(clean);
  });

  it("refuses a reading that does not give one syllable per character", async () => {
    expect(await check("我想打电话", "wǒ xiǎng")).toEqual(
      err({ kind: "invalid-reading", reading: "wǒ xiǎng" }),
    );
  });

  it("has nothing to check without Chinese characters", async () => {
    expect(await check("OK!", "")).toEqual(clean);
  });
});

describe("checkReading", () => {
  it("returns the dictionary's failure", async () => {
    const failure = err({ kind: "storage-failure", message: "closed" } as const);
    const failing = createReadingCheck(() => Promise.resolve(failure), createSegmenter(new Set()));
    expect(await failing("好", "hǎo")).toEqual(failure);
  });

  it("flags a character the dictionary does not have", async () => {
    const empty = createReadingCheck(inMemoryDictionary([]), createSegmenter(new Set()));
    expect(await empty("龘", "dá")).toEqual({
      ok: true,
      value: [{ start: 0, end: 1, written: "da2", readings: [] }],
    });
  });
});
