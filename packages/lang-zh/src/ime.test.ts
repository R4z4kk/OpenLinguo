import { err, ok, type ImeCandidate } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { createIme, splitPinyin, type ImeWord, type ImeWordsOf } from "./ime.ts";
import { searchKey } from "./pinyin-search.ts";

const word = (headword: string, reading: string, frequency: number | null): ImeWord => ({
  headword,
  reading,
  frequency,
});

const WORDS: readonly ImeWord[] = [
  word("先", "xian1", 5.6),
  word("现", "xian4", 5.8),
  word("西安", "Xi1 an1", 4.9),
  word("西", "xi1", 5.4),
  word("系", "xi4", 5.7),
  word("安", "an1", 5.2),
  word("你好", "ni3 hao3", 5.5),
  word("你", "ni3", 6.7),
  word("好", "hao3", 6.4),
  word("好", "hao4", 6.4),
  word("吗", "ma5", 6.5),
  word("妈", "ma1", 5.0),
  word("马", "ma3", 5.1),
  word("女", "nu:3", 5.3),
  word("女儿", "nu:3 er2", 5.0),
  word("哪儿", "na3 r5", 5.3),
  word("哪", "na3", 5.6),
  word("马克·吐温", "Ma3 ke4 · Tu3 wen1", 2.4),
  word("仙姑", "xian1 gu1", null),
];

const byKey = new Map<string, ImeWord[]>();
for (const entry of WORDS) {
  const key = searchKey(entry.reading);
  byKey.set(key, [...(byKey.get(key) ?? []), entry]);
}
const keysAsked: string[] = [];
const wordsOf: ImeWordsOf = (key) => {
  keysAsked.push(key);
  return Promise.resolve(ok(byKey.get(key) ?? []));
};
const ime = createIme(wordsOf);

const splits = (input: string): string[] =>
  splitPinyin(input).map((split) =>
    split.map(({ letters, tone }) => `${letters}${tone === null ? "" : String(tone)}`).join("'"),
  );

const texts = async (input: string): Promise<readonly string[]> => {
  const result = await ime.candidates(input);
  if (!result.ok) throw new Error(`no candidates: ${result.error.kind}`);
  return result.value.map(({ text }) => text);
};

const candidate = async (input: string, text: string): Promise<ImeCandidate | null> => {
  const result = await ime.candidates(input);
  if (!result.ok) return null;
  return result.value.find((found) => found.text === text) ?? null;
};

describe("splitPinyin", () => {
  it("keeps every valid split, longest syllables first", () => {
    expect(splits("xian")).toEqual(["xian", "xi'an"]);
    expect(splits("nihao")).toEqual(["ni'hao", "ni'ha'o"]);
  });

  it("splits where an apostrophe stands, and only there across it", () => {
    expect(splits("xi'an")).toEqual(["xi'an"]);
    expect(splits("xi’an")).toEqual(["xi'an"]);
  });

  it("reads v and ü as ü", () => {
    expect(splits("nv")).toEqual(["nv"]);
    expect(splits("nü")).toEqual(["nv"]);
    expect(splits("lve")).toEqual(["lve", "lv'e"]);
  });

  it("reads a digit 1–5 after a syllable as its tone", () => {
    expect(splits("xian1")).toEqual(["xian1", "xi'an1"]);
    expect(splits("ni3hao3")).toEqual(["ni3'hao3", "ni3'ha'o3"]);
    expect(splits("ma5")).toEqual(["ma5", "m'a5"]);
  });

  it("ignores case", () => {
    expect(splits("XiAn")).toEqual(["xian", "xi'an"]);
  });

  it("reads erhua after another syllable only", () => {
    expect(splits("nar")).toEqual(["na'r"]);
    expect(splits("r")).toEqual([]);
  });

  it("splits the start of the input up to the furthest syllable a split reaches", () => {
    expect(splits("xiang")).toEqual(["xiang", "xi'ang"]);
    expect(splits("nihaozh")).toEqual(["ni'hao", "ni'ha'o"]);
    expect(splits("ni6")).toEqual(["ni"]);
  });

  it("finds no syllable at the start of other input", () => {
    expect(splits("")).toEqual([]);
    expect(splits("zh")).toEqual([]);
    expect(splits("3ma")).toEqual([]);
    expect(splits("你好")).toEqual([]);
  });

  it("skips apostrophes before the first syllable", () => {
    expect(splits("'an")).toEqual(["an"]);
  });
});

describe("ime candidates", () => {
  it("ranks words covering more of the input first, then by frequency", async () => {
    expect(await texts("xian")).toEqual(["现", "先", "西安", "系", "西"]);
    expect(await texts("nihao")).toEqual(["你好", "你"]);
  });

  it("says how much input each candidate consumes, apostrophes and tones included", async () => {
    expect(await candidate("nihaoma", "你好")).toEqual({ text: "你好", consumed: 5 });
    expect(await candidate("ni3hao3ma", "你好")).toEqual({ text: "你好", consumed: 7 });
    expect(await candidate("xi'an", "西")).toEqual({ text: "西", consumed: 3 });
    expect(await candidate("xi'an", "西安")).toEqual({ text: "西安", consumed: 5 });
  });

  it("offers nothing a valid split of the input leaves out", async () => {
    expect(await texts("xi'an")).toEqual(["西安", "系", "西"]);
    // xiang is no xian followed by a syllable.
    expect(await candidate("xiang", "先")).toBeNull();
  });

  it("filters candidates by the tones typed", async () => {
    expect(await texts("xian1")).toEqual(["先", "西安", "系", "西"]);
    expect(await texts("xi1an")).toEqual(["西安", "西"]);
    expect(await texts("ma1")).toEqual(["妈"]);
    expect(await texts("ma5")).toEqual(["吗"]);
    expect(await texts("hao4")).toEqual(["好"]);
  });

  it("lists a word once, whatever reading matches", async () => {
    expect(await texts("hao")).toEqual(["好"]);
  });

  it("reads ü typed as v", async () => {
    expect(await texts("nv")).toEqual(["女"]);
    expect(await texts("nver")).toEqual(["女儿", "女"]);
  });

  it("types erhua", async () => {
    expect(await texts("nar")).toEqual(["哪儿", "哪"]);
  });

  it("skips punctuation inside a name", async () => {
    expect(await texts("maketuwen")).toEqual(["马克·吐温", "吗", "马", "妈"]);
  });

  it("puts words of unknown frequency last, proper nouns after common words", async () => {
    const words = [
      word("咸", "xian2", null),
      word("冼", "Xian3", 3.1),
      word("显", "xian3", 3.1),
      word("先", "xian1", 5.6),
    ];
    const small = createIme((key) => Promise.resolve(ok(key === "xian" ? words : [])));
    const result = await small.candidates("xian");
    expect(result.ok && result.value.map(({ text }) => text)).toEqual(["先", "显", "冼", "咸"]);
  });

  it("offers a word covering the whole input first, whatever its frequency", async () => {
    expect(await texts("xiangu")).toEqual(["仙姑", "现", "先", "西安", "系", "西"]);
  });

  it("asks the dictionary once per syllable boundary", async () => {
    keysAsked.length = 0;
    await ime.candidates("xi'an");
    expect(keysAsked.sort()).toEqual(["xi", "xian"]);
  });

  it("returns an error, never an empty list, when nothing can be offered", async () => {
    expect(await ime.candidates("")).toEqual(err({ kind: "unknown-input", input: "" }));
    expect(await ime.candidates("zh")).toEqual(err({ kind: "unknown-input", input: "zh" }));
    expect(await ime.candidates("ê")).toEqual(err({ kind: "unknown-input", input: "ê" }));
    expect(await ime.candidates("zhuang")).toEqual(err({ kind: "no-match", input: "zhuang" }));
    expect(await ime.candidates("ma2")).toEqual(err({ kind: "no-match", input: "ma2" }));
  });

  it("returns the dictionary's failure", async () => {
    const failing = createIme(() =>
      Promise.resolve(err({ kind: "storage-failure", message: "closed" })),
    );
    expect(await failing.candidates("xian")).toEqual(
      err({ kind: "storage-failure", message: "closed" }),
    );
  });
});
