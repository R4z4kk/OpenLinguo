import { inMemoryDictionary, type AnnotatedToken, type DictEntry } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { createSegmenter } from "./segment.ts";
import { createTextReading } from "./text-reading.ts";
import { findUnknownSequences, sentenceAround } from "./unknown-sequences.ts";

const word = (headword: string, level: number | null = null): DictEntry => ({
  headword,
  variants: [],
  reading: "x1",
  glosses: [{ lang: "en", text: "gloss", source: "test" }],
  level,
});

const COMMON = ["我", "他", "和", "的", "在", "了", "很", "多", "说", "也", "是", "好"];
const OTHER = ["王", "小", "红", "李", "明", "拍", "家", "学校", "老师"];
const entries = [...COMMON.map((headword) => word(headword, 1)), ...OTHER.map((w) => word(w))];
const reading = createTextReading(
  inMemoryDictionary(entries),
  createSegmenter(new Set(entries.map(({ headword }) => headword))),
);
const isCommon = (headword: string): boolean => COMMON.includes(headword);

const sequencesOf = async (text: string, extra: ReadonlySet<string> = new Set()) => {
  const annotated = await reading.annotate(text, extra);
  if (!annotated.ok) throw new Error(annotated.error.kind);
  return findUnknownSequences(annotated.value, isCommon);
};

describe("findUnknownSequences", () => {
  it("cuts the edges of a run on common words", async () => {
    expect(await sequencesOf("他和王小红在学校")).toEqual([
      { text: "王小红", start: 2, end: 5, compositional: false },
    ]);
  });

  it("keeps a run of only common words, flagged compositional", async () => {
    expect(await sequencesOf("学校。我很好。")).toEqual([
      { text: "我很好", start: 3, end: 6, compositional: true },
    ]);
  });

  it("finds a lone character outside the dictionary", async () => {
    expect(await sequencesOf("学校玥老师")).toEqual([
      { text: "玥", start: 2, end: 3, compositional: false },
    ]);
  });

  it("ignores a lone dictionary character and what a cut leaves of one", async () => {
    expect(await sequencesOf("学校红老师")).toEqual([]);
    expect(await sequencesOf("学校的红老师")).toEqual([]);
  });

  it("breaks a run at punctuation, spaces and words", async () => {
    expect(await sequencesOf("王，小红 拍学校李明")).toEqual([
      { text: "小红", start: 2, end: 4, compositional: false },
      { text: "李明", start: 8, end: 10, compositional: false },
    ]);
  });

  it("lists a sequence once, at its first occurrence", async () => {
    const found = await sequencesOf("王小红说了。王小红在学校");
    expect(found.map(({ text, start }) => [text, start])).toEqual([["王小红", 0]]);
  });

  it("no longer finds a sequence once it is a headword of the personal lexicon", async () => {
    const found = await sequencesOf("他和王小红在学校", new Set(["王小红"]));
    expect(found.filter(({ compositional }) => !compositional)).toEqual([]);
  });

  it("counts a character outside the BMP as one", () => {
    const tokens: readonly AnnotatedToken[] = [
      { text: "𠀀", start: 0, end: 2, isWord: true, readings: [], ambiguous: false },
      { text: "红", start: 2, end: 3, isWord: true, readings: ["hong2"], ambiguous: false },
    ];
    expect(findUnknownSequences(tokens, isCommon)).toEqual([
      { text: "𠀀红", start: 0, end: 3, compositional: false },
    ]);
  });
});

describe("sentenceAround", () => {
  const sentence = (body: string, text: string) => {
    const start = body.indexOf(text);
    return sentenceAround(body, start, start + text.length);
  };

  it("stops at sentence-final punctuation, keeping the closing one", () => {
    expect(sentence("你好吗？他和王小红在学校。再见！", "王小红")).toEqual({
      before: "他和",
      after: "在学校。",
    });
  });

  it("stops at a line break, a semicolon and the text ends", () => {
    expect(sentence("第一行\n他和王小红来；走了", "王小红")).toEqual({
      before: "他和",
      after: "来；",
    });
    expect(sentence("王小红", "王小红")).toEqual({ before: "", after: "" });
  });

  it("keeps 60 characters around a sequence in a text without punctuation", () => {
    const body = `${"左".repeat(80)}王小红${"右".repeat(80)}`;
    expect(sentenceAround(body, 80, 83)).toEqual({
      before: `…${"左".repeat(60)}`,
      after: `${"右".repeat(60)}…`,
    });
  });

  it("leaves closing quotes to the sentence they close", () => {
    expect(sentence("他说：“好。”王小红来了。”", "王小红")).toEqual({
      before: "",
      after: "来了。”",
    });
  });
});
