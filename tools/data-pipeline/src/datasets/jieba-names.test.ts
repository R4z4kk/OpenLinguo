import { err, ok } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import type { ShardReader } from "../run.ts";
import { noFile } from "../testing/readers.ts";
import { jiebaNames, loadKnownForms, parseJiebaDict } from "./jieba-names.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const dict = [
  "B超 3 n",
  "张三丰 52 nr",
  "上官婉儿 7 nrfg",
  "乌兰察布 34 ns",
  "联合国 1210 nt",
  "阿姆斯特丹 51 nrt",
  "阿姆斯特丹 51 nrt",
  "新华社 233 nz",
  "北京 34488 ns",
  "臺北 12 ns",
  "大S 3 nr",
  "C++ 3 nz",
  "",
].join("\n");

const shards: Readonly<Record<string, readonly unknown[][]>> = {
  "cc-cedict": [[["北京", "北京", "Bei3 jing1", ["Beijing"]]]],
  cfdict: [[["北京", "bei3 jing1", ["Pékin"]]], [["台北", "臺北", "Tai2 bei3", ["Taipei"]]]],
  "wiktionary-fr-zh": [[["新华", "新華", "xin1 hua2", ["Xinhua"]]]],
  "wiktionary-zh": [[["联合国", "聯合國", "Lian2 he2 guo2", "name", ["United Nations"]]]],
};

const readShards: ShardReader = (dataset) =>
  Promise.resolve(ok((shards[dataset] ?? []).map((rows) => JSON.stringify(rows))));

describe("parseJiebaDict", () => {
  it("keeps the name-tagged words no lexicon has, with their kind", async () => {
    const known = await loadKnownForms(readShards);
    if (!known.ok) throw new Error(known.error);
    const release = parseJiebaDict(dict, known.value);
    if (!release.ok) throw new Error(release.error);
    expect(release.value.rows).toEqual([
      ["上官婉儿", "person"],
      ["乌兰察布", "place"],
      ["张三丰", "person"],
      ["新华社", "name"],
      ["阿姆斯特丹", "name"],
    ]);
    expect(release.value.known).toBe(3);
    expect(release.value.issues).toEqual([
      { word: "大S", kind: "non-han-title", tag: "nr" },
      { word: "C++", kind: "non-han-title", tag: "nz" },
    ]);
  });

  it("rejects a line that is not word, frequency and tag", () => {
    expect(parseJiebaDict("张三丰 52 nr\n张三 nr\n", new Set())).toEqual(
      err('line 2 is not "word frequency tag": 张三 nr'),
    );
    expect(parseJiebaDict("张三丰 many nr", new Set()).ok).toBe(false);
  });
});

describe("jiebaNames", () => {
  it("writes the names, the license, the issues and the payload", async () => {
    const built = await jiebaNames.build(bytes(dict), readShards, noFile);
    if (!built.ok) throw new Error(built.error);
    expect(built.value.version).toBe("fxsjy/jieba@67fa2e3");
    expect(built.value.files.get("names-000.json")).toBe(
      '[\n["上官婉儿","person"],\n["乌兰察布","place"],\n["张三丰","person"],\n["新华社","name"],\n["阿姆斯特丹","name"]\n]\n',
    );
    expect(built.value.files.get("jieba-MIT.txt")).toContain("Copyright (c) 2013 Sun Junyi");
    expect(built.value.files.get("issues.tsv")).toBe(
      "word\tissue\ttag\n大S\tnon-han-title\tnr\nC++\tnon-han-title\tnz\n",
    );
    expect(built.value.summary).toBe(
      "5 names kept (1 nr, 1 nrfg, 1 ns, 0 nt, 1 nrt, 1 nz); skipped: 3 already in a lexicon; issues: 2 non-han-title",
    );
    expect(built.value.files.get("README.md")).toMatch(
      /- Payload: 0\.0 MB of JSON in 1 files, 0\.0 MB gzipped\.\n$/u,
    );
  });

  it("requires every lexicon to be built first", async () => {
    const built = await jiebaNames.build(
      bytes(dict),
      (dataset) => (dataset === "wiktionary-zh" ? Promise.resolve(ok([])) : readShards(dataset)),
      noFile,
    );
    expect(built).toEqual(err("wiktionary-zh must be built before jieba-names"));
  });

  it("rejects a lexicon shard of another shape", async () => {
    const built = await jiebaNames.build(
      bytes(dict),
      (dataset) =>
        dataset === "cfdict" ? Promise.resolve(ok(['[["北京"]]'])) : readShards(dataset),
      noFile,
    );
    expect(built).toEqual(err("invalid cfdict shard structure"));
  });
});
