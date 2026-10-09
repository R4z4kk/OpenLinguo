import { beforeAll, describe, expect, it } from "vitest";
import { createSegmenter } from "./segment.ts";
import { loadCedictRows } from "./testing/cedict-shards.ts";

const words = (segment: ReturnType<typeof createSegmenter>, text: string): string =>
  segment(text)
    .map((token) => token.text)
    .join("|");

describe("createSegmenter", () => {
  const segment = createSegmenter(
    new Set(["研究", "研究生", "生命", "起源", "的", "电话", "𠮷野"]),
  );

  it("prefers the backward match when it yields fewer single characters", () => {
    expect(words(segment, "研究生命的起源")).toBe("研究|生命|的|起源");
  });

  it("degrades unknown sequences to single characters", () => {
    expect(words(segment, "龘靐电话")).toBe("龘|靐|电话");
  });

  it("keeps astral characters whole and offsets in UTF-16 units", () => {
    expect(segment("𠮷野电话")).toEqual([
      { text: "𠮷野", start: 0, end: 3, isWord: true },
      { text: "电话", start: 3, end: 5, isWord: true },
    ]);
  });

  it("groups unknown Latin letters and digits, and flags punctuation", () => {
    expect(segment("用iPhone 15打电话。")).toEqual([
      { text: "用", start: 0, end: 1, isWord: true },
      { text: "iPhone", start: 1, end: 7, isWord: true },
      { text: " ", start: 7, end: 8, isWord: false },
      { text: "15", start: 8, end: 10, isWord: true },
      { text: "打", start: 10, end: 11, isWord: true },
      { text: "电话", start: 11, end: 13, isWord: true },
      { text: "。", start: 13, end: 14, isWord: false },
    ]);
  });

  it("returns no token for empty text", () => {
    expect(segment("")).toEqual([]);
  });
});

describe("segmentation golden samples on CC-CEDICT", () => {
  let segment: ReturnType<typeof createSegmenter>;

  beforeAll(async () => {
    segment = createSegmenter(new Set((await loadCedictRows()).map(([simplified]) => simplified)));
  });

  it.each([
    ["研究生命的起源", "研究|生命|的|起源"],
    ["结婚的和尚未结婚的", "结婚|的|和|尚未|结婚|的"],
    ["他说的确实在理", "他|说|的|确实|在理"],
    ["乒乓球拍卖完了", "乒乓球|拍卖|完了"],
    ["南京市长江大桥", "南京市|长江|大桥"],
    ["他从马上下来", "他|从|马上|下来"],
    ["学生会组织活动", "学生会|组织|活动"],
    ["这个门把手坏了", "这个|门把手|坏了"],
    ["我想打电话给你。", "我|想|打电话|给|你|。"],
    ["今天天气很好，我们去公园散步吧。", "今天|天气|很|好|，|我们|去|公园|散步|吧|。"],
    ["中华人民共和国成立了。", "中华人民共和国|成立|了|。"],
    ["我买了很多东西。", "我|买|了|很|多|东西|。"],
    ["小明的妈妈是老师。", "小|明|的|妈妈|是|老师|。"],
  ])("%s → %s", (text, expected) => {
    expect(words(segment, text)).toBe(expected);
  });
});
