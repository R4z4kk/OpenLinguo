import {
  err,
  inMemoryDictionary,
  ok,
  type AnnotatedToken,
  type DictEntry,
  type DictionaryLookup,
  type ReadingChoices,
} from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { createSegmenter } from "./segment.ts";
import { createTextReading } from "./text-reading.ts";

const word = (
  headword: string,
  reading: string | null,
  level: number | null = null,
): DictEntry => ({
  headword,
  variants: [],
  reading,
  glosses: [{ lang: "en", text: "gloss", source: "test" }],
  level,
});

const entries: readonly DictEntry[] = [
  word("了", "liao3"),
  word("了", "le5", 1),
  word("行", "hang2"),
  word("行", "xing2", 3),
  word("行", "heng2"),
  word("长", "zhang3"),
  word("长", "chang2", 2),
  word("曾", "Zeng1"),
  word("曾", "ceng2"),
  word("你好", "ni3 hao3", 1),
  word("老师", "lao3 shi1", 1),
  word("我", "wo3", 1),
  word("很", "hen3", 1),
  word("好", "hao3", 1),
  word("好", "hao4", 1),
  word("不", "bu4", 1),
  word("对", "dui4", 1),
  word("一", "yi1", 1),
  word("个", "ge4", 1),
  word("用", "yong4", 1),
];

const lexicon = new Set(entries.map(({ headword }) => headword));
const textReading = (lookup: DictionaryLookup) =>
  createTextReading(lookup, createSegmenter(lexicon));
const reading = textReading(inMemoryDictionary(entries));

const annotate = async (
  text: string,
  extra: ReadonlySet<string> = new Set(),
): Promise<readonly AnnotatedToken[]> => {
  const annotated = await reading.annotate(text, extra);
  if (!annotated.ok) throw new Error(`annotate failed: ${annotated.error.kind}`);
  return annotated.value;
};

const pinyin = async (
  text: string,
  chosen: ReadingChoices = {},
): Promise<readonly (string | null)[]> => {
  const spoken = reading.pinyin(await annotate(text), chosen);
  if (!spoken.ok) throw new Error(`pinyin failed: ${spoken.error.kind}`);
  return spoken.value;
};

describe("annotate", () => {
  it.each([
    ["了", ["le5", "liao3"]],
    ["长", ["chang2", "zhang3"]],
    ["行", ["xing2", "hang2", "heng2"]],
    ["曾", ["ceng2", "Zeng1"]],
  ])(
    "orders the readings of %s by level, then common words, then the dictionary",
    async (text, readings) => {
      const [token] = await annotate(text);
      expect(token).toMatchObject({ text, isWord: true, readings, ambiguous: true });
    },
  );

  it("does not flag a word with one reading", async () => {
    expect(await annotate("你好")).toEqual([
      { text: "你好", start: 0, end: 2, isWord: true, readings: ["ni3 hao3"], ambiguous: false },
    ]);
  });

  it("lists a reading once, and none for an entry without one", async () => {
    const lookup: DictionaryLookup = () =>
      Promise.resolve(ok([word("了", "le5"), word("了", null), word("了", "le5", 2)]));
    const annotated = await textReading(lookup).annotate("了");
    expect(annotated).toMatchObject({ ok: true, value: [{ readings: ["le5"], ambiguous: false }] });
  });

  it("marks punctuation, Latin letters and digits as non-words", async () => {
    expect(await annotate("用iPhone 15。")).toEqual([
      { text: "用", start: 0, end: 1, isWord: true, readings: ["yong4"], ambiguous: false },
      { text: "iPhone", start: 1, end: 7, isWord: false, readings: [], ambiguous: false },
      { text: " ", start: 7, end: 8, isWord: false, readings: [], ambiguous: false },
      { text: "15", start: 8, end: 10, isWord: false, readings: [], ambiguous: false },
      { text: "。", start: 10, end: 11, isWord: false, readings: [], ambiguous: false },
    ]);
  });

  it("keeps an unknown character as a word without readings", async () => {
    expect(await annotate("龘")).toEqual([
      { text: "龘", start: 0, end: 1, isWord: true, readings: [], ambiguous: false },
    ]);
  });

  it("cuts extra headwords as words, with no readings of their own", async () => {
    expect(await annotate("王小红用", new Set(["王小红"]))).toMatchObject([
      { text: "王小红", start: 0, end: 3, isWord: true, readings: [] },
      { text: "用", start: 3, end: 4, readings: ["yong4"] },
    ]);
  });

  it("looks each distinct word up once", async () => {
    const asked: string[] = [];
    const lookup: DictionaryLookup = (term) => {
      asked.push(term);
      return inMemoryDictionary(entries)(term);
    };
    await textReading(lookup).annotate("了好了，好了");
    expect(asked.toSorted()).toEqual(["了", "好"]);
  });

  it("keeps the lookups in flight to a few, whatever the number of words", async () => {
    const characters = Array.from({ length: 250 }, (_, index) =>
      String.fromCodePoint(0x4e00 + index),
    );
    let inFlight = 0;
    let most = 0;
    const lookup: DictionaryLookup = async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return ok([]);
    };
    const annotated = await textReading(lookup).annotate(characters.join(""));
    expect(annotated.ok && annotated.value).toHaveLength(250);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(100);
  });

  it("returns the lookup's failure", async () => {
    const lookup: DictionaryLookup = () =>
      Promise.resolve(err({ kind: "storage-failure", message: "closed" }));
    expect(await textReading(lookup).annotate("了")).toEqual({
      ok: false,
      error: { kind: "storage-failure", message: "closed" },
    });
  });

  it("returns no token for empty text", async () => {
    expect(await annotate("")).toEqual([]);
  });
});

describe("pinyin", () => {
  it("reads each word as its first reading, with sandhi inside the word", async () => {
    expect(await pinyin("你好用")).toEqual(["ni2 hao3", "yong4"]);
  });

  it("applies the third-tone sandhi across words", async () => {
    expect(await pinyin("我很好")).toEqual(["wo3", "hen2", "hao3"]);
  });

  it("applies 不 and 一 sandhi across words", async () => {
    expect(await pinyin("不对")).toEqual(["bu2", "dui4"]);
    expect(await pinyin("一个")).toEqual(["yi2", "ge4"]);
  });

  it("stops sandhi at punctuation, with no pinyin for it", async () => {
    expect(await pinyin("我好")).toEqual(["wo2", "hao3"]);
    expect(await pinyin("我，好")).toEqual(["wo3", null, "hao3"]);
  });

  it("stops sandhi at a word without reading", async () => {
    expect(await pinyin("我龘好")).toEqual(["wo3", null, "hao3"]);
  });

  it("reads the chosen reading of an occurrence only", async () => {
    expect(await pinyin("了了", { 1: "liao3" })).toEqual(["le5", "liao3"]);
  });

  it("applies sandhi to the chosen reading", async () => {
    expect(await pinyin("不好")).toEqual(["bu4", "hao3"]);
    expect(await pinyin("不好", { 1: "hao4" })).toEqual(["bu2", "hao4"]);
  });

  it("ignores a choice that is not a reading of its token", async () => {
    expect(await pinyin("了了", { 0: "liao4", 1: "le5" })).toEqual(["le5", "le5"]);
  });

  it("returns an invalid reading as an error", () => {
    const token: AnnotatedToken = {
      text: "么",
      start: 0,
      end: 1,
      isWord: true,
      readings: ["zzz9"],
      ambiguous: false,
    };
    expect(reading.pinyin([token])).toEqual({
      ok: false,
      error: { kind: "invalid-reading", reading: "zzz9" },
    });
  });
});
