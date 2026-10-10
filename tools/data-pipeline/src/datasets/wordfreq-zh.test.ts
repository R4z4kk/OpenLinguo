import { gzipSync } from "node:zlib";
import { err, ok } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import type { ShardReader } from "../run.ts";
import { headwordFrequencies, parseCBPack, wordfreqZh } from "./wordfreq-zh.ts";

/** MessagePack of strings, small integers, arrays and string-keyed maps. */
const encode = (value: unknown): number[] => {
  if (typeof value === "number") return [value];
  if (typeof value === "string") {
    const bytes = [...new TextEncoder().encode(value)];
    return [0xd9, bytes.length, ...bytes];
  }
  if (Array.isArray(value)) {
    return [0xdc, value.length >> 8, value.length & 0xff, ...value.flatMap(encode)];
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return [
    0x80 | entries.length,
    ...entries.flatMap(([key, item]) => [...encode(key), ...encode(item)]),
  ];
};

const pack = (...values: unknown[]): Uint8Array => gzipSync(new Uint8Array(encode(values)));
const header = { format: "cB", version: 1 };

/** Buckets 0 … 120 empty, 的 in bucket 121, then 电话 and 電話 in bucket 356. */
const list = (): unknown[] => {
  const buckets: string[][] = Array.from({ length: 357 }, () => []);
  buckets[121] = ["的"];
  buckets[356] = ["电话", "電話"];
  return [header, ...buckets];
};

describe("parseCBPack", () => {
  it("turns bucket numbers into Zipf frequencies", () => {
    const zipf = parseCBPack(pack(...list()));
    expect(zipf.ok && [...zipf.value]).toEqual([
      ["的", 7.79],
      ["电话", 5.44],
      ["電話", 5.44],
    ]);
  });

  it("rejects another format, a word in two buckets and a non-gzip file", () => {
    expect(parseCBPack(pack({ format: "cB", version: 2 }))).toEqual(
      err("not a cB version 1 word list"),
    );
    expect(parseCBPack(pack(header, ["的"], ["的"]))).toEqual(err("的 appears in two buckets"));
    expect(parseCBPack(new Uint8Array([1, 2, 3])).ok).toBe(false);
  });
});

describe("headwordFrequencies", () => {
  it("keeps dictionary headwords, most frequent first", () => {
    const zipf = new Map([
      ["电话", 5.44],
      ["的", 7.79],
      ["电脑", 5.44],
      ["電話", 5.44],
    ]);
    expect(headwordFrequencies(zipf, new Set(["的", "电脑", "电话", "电"]))).toEqual([
      ["的", 7.79],
      ["电脑", 5.44],
      ["电话", 5.44],
    ]);
  });
});

describe("wordfreq-zh dataset", () => {
  const shards: Record<string, string[]> = {
    "cc-cedict": [JSON.stringify([["电话", "電話", "dian4 hua4", ["telephone"]]])],
    cfdict: [JSON.stringify([["电话", "dian4 hua4", ["téléphone"]]])],
    "wiktionary-fr-zh": [JSON.stringify([["的", "的", "de5", ["de"]]])],
  };

  it("writes the headword frequencies and an attribution readme", async () => {
    const reader: ShardReader = (dataset) => Promise.resolve(ok(shards[dataset] ?? []));
    const built = await wordfreqZh.build(pack(...list()), reader);
    if (!built.ok) throw new Error(built.error);
    expect(built.value.files.get("words-000.json")).toBe('[\n["的",7.79],\n["电话",5.44]\n]\n');
    expect(built.value.summary).toBe(
      "2 of 2 dictionary headwords have a frequency (3 words in the list)",
    );
    expect(built.value.files.get("README.md")).toContain("SUBTLEX-CH");
  });

  it("requires the dictionaries to be built first", async () => {
    const built = await wordfreqZh.build(pack(...list()), (dataset) =>
      Promise.resolve(ok(dataset === "cc-cedict" ? (shards[dataset] ?? []) : [])),
    );
    expect(built).toEqual(err("cfdict must be built before wordfreq-zh"));
  });
});
