import "fake-indexeddb/auto";
import {
  err,
  inMemoryDictionary,
  knownWords,
  ok,
  type AnnotatedToken,
  type DictEntry,
  type DictionaryLookup,
  type KnownWords,
  type TextReadingFeature,
} from "@openlinguo/core";
import { createZhPack } from "@openlinguo/lang-zh";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.ts";
import { annotateText, gapToTarget, paragraphsOf, readerView } from "./reader.ts";

const entry = (headword: string, reading: string): DictEntry => ({
  headword,
  variants: [],
  reading,
  glosses: [],
  level: null,
});
const entries = [
  entry("我们", "wo3 men5"),
  entry("去", "qu4"),
  entry("学校", "xue2 xiao4"),
  entry("你好", "ni3 hao3"),
  entry("说", "shuo1"),
  entry("行", "xing2"),
  entry("行", "hang2"),
];
const pack = createZhPack({
  lookup: inMemoryDictionary(entries),
  lexicon: new Set(entries.map(({ headword }) => headword)),
  proficiency: "hsk-2025",
  decompositions: new Map(),
  strokesOf: () => Promise.resolve(ok(null)),
  wordsOfPinyin: () => Promise.resolve(ok([])),
});
const reading = pack.features.textReading;
if (reading === null) throw new Error("the zh pack reads texts");

const annotate = async (text: string): Promise<readonly AnnotatedToken[]> => {
  const tokens = await reading.annotate(text);
  if (!tokens.ok) throw new Error(tokens.error.kind);
  return tokens.value;
};

const nobody: KnownWords = knownWords({ language: "zh", cards: [], marks: [], names: [] });
const knowing = (...marks: string[]): KnownWords =>
  knownWords({
    language: "zh",
    cards: [],
    marks: marks.map((mark) => {
      const [headword = "", readingKey = ""] = mark.split("|");
      return { headword, readingKey };
    }),
    names: [],
  });

describe("annotateText", () => {
  const packWith = (lookup: DictionaryLookup): TextReadingFeature => {
    const feature = createZhPack({
      lookup,
      lexicon: new Set(entries.map(({ headword }) => headword)),
      proficiency: "hsk-2025",
      decompositions: new Map(),
      strokesOf: () => Promise.resolve(ok(null)),
      wordsOfPinyin: () => Promise.resolve(ok([])),
    }).features.textReading;
    if (feature === null) throw new Error("the zh pack reads texts");
    return feature;
  };

  it("runs every lookup of the text in one read transaction", async () => {
    const db = openDatabase("reader-annotate-test");
    const transactions = new Set<unknown>();
    const feature = packWith(async (term) => {
      transactions.add(Dexie.currentTransaction);
      await db.entries.where("simplified").equals(term).toArray();
      return ok([entry(term, "xx1")]);
    });
    const tokens = await annotateText(db, feature, "我们去学校，你好");
    expect(tokens.ok && tokens.value.filter(({ isWord }) => isWord)).toHaveLength(4);
    expect(transactions.size).toBe(1);
    expect(transactions.has(null)).toBe(false);
  });

  it("keeps the transaction open through every wave of lookups", async () => {
    const db = openDatabase("reader-annotate-waves-test");
    const transactions = new Set<unknown>();
    const feature = packWith(async (term) => {
      transactions.add(Dexie.currentTransaction);
      await db.entries.where("simplified").equals(term).toArray();
      return ok([entry(term, "xx1")]);
    });
    const body = Array.from({ length: 250 }, (_, index) => String.fromCodePoint(0x4e00 + index));
    const tokens = await annotateText(db, feature, body.join(""));
    expect(tokens.ok && tokens.value).toHaveLength(250);
    expect(transactions.size).toBe(1);
  });

  it("reports a storage failure", async () => {
    const db = openDatabase("reader-annotate-closed-test");
    await db.open();
    db.close();
    const result = await annotateText(db, packWith(inMemoryDictionary(entries)), "我们");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("storage");
  });
});

describe("paragraphsOf", () => {
  it("keeps closing punctuation with the word before it and opening marks with the next", async () => {
    const tokens = await annotate("他说：“你好。”");
    expect(paragraphsOf(tokens)).toEqual([
      [
        { kind: "word", index: 0, before: "", after: "" },
        { kind: "word", index: 1, before: "", after: "：" },
        { kind: "word", index: 4, before: "“", after: "。”" },
      ],
    ]);
  });

  it("splits on line breaks and leaves out empty paragraphs", async () => {
    const tokens = await annotate("我们去学校。\n\n  \n你好");
    expect(paragraphsOf(tokens)).toHaveLength(2);
    expect(paragraphsOf(tokens)[1]).toEqual([{ kind: "word", index: 9, before: "", after: "" }]);
  });

  it("leaves Latin letters and digits as text", async () => {
    const tokens = await annotate("我们 OK 2026");
    const kinds = paragraphsOf(tokens)[0]?.map(({ kind }) => kind);
    expect(kinds).toEqual(["word", "text", "text", "text", "text"]);
  });

  it("keeps an opening mark with nothing after it as text", async () => {
    const tokens = await annotate("我们“");
    expect(paragraphsOf(tokens)[0]).toEqual([
      { kind: "word", index: 0, before: "", after: "" },
      { kind: "text", text: "“" },
    ]);
  });
});

describe("readerView", () => {
  it("gives each token its knowledge, its spoken pinyin and the words the dictionary lacks", async () => {
    const tokens = await annotate("我们去学校，龘。");
    const view = readerView(reading, tokens, knowing("我们|wo3 men5"), {});
    if (!view.ok) throw new Error(view.error.kind);
    expect(view.value.knowledge.slice(0, 3)).toEqual(["known", "unknown", "unknown"]);
    expect(view.value.spoken?.slice(0, 3)).toEqual(["wo3 men5", "qu4", "xue2 xiao4"]);
    expect(view.value.unresolved).toEqual(["龘"]);
    expect(view.value.measure).toMatchObject({ known: 1, total: 4, unresolved: 1 });
    expect(view.value.pinyinFailure).toBeNull();
  });

  it("reads a polyphone as the reading chosen for its occurrence", async () => {
    const tokens = await annotate("行");
    const first = readerView(reading, tokens, nobody, {});
    const chosen = readerView(reading, tokens, nobody, { 0: "hang2" });
    if (!first.ok || !chosen.ok) throw new Error("the view fails");
    expect(first.value.spoken).toEqual(["xing2"]);
    expect(chosen.value.spoken).toEqual(["hang2"]);
  });

  it("keeps the text when its pinyin cannot be worked out", async () => {
    const tokens = await annotate("我们");
    const failing: TextReadingFeature = {
      ...reading,
      pinyin: () => err({ kind: "unaligned-reading", text: "我们", reading: "wo3" }),
    };
    const view = readerView(failing, tokens, nobody, {});
    if (!view.ok) throw new Error(view.error.kind);
    expect(view.value.spoken).toBeNull();
    expect(view.value.pinyinFailure).toEqual({
      kind: "unaligned-reading",
      text: "我们",
      reading: "wo3",
    });
    expect(view.value.paragraphs).toHaveLength(1);
  });
});

describe("gapToTarget", () => {
  it("counts the points left, never below zero", () => {
    expect(gapToTarget(96, 98)).toBe(2);
    expect(gapToTarget(98, 98)).toBe(0);
    expect(gapToTarget(100, 95)).toBe(0);
  });
});
