import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { err, ok } from "@openlinguo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "./database.ts";
import { importExtendedLexicon, lookupExtended } from "./extended-lexicon.ts";
import type { DataIndex, OnDemandIndex, ExtendedRow } from "./format.ts";
import { importData, type FetchFile, type ImportProgress } from "./import.ts";

const encode = (value: unknown): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(JSON.stringify(value));
const hash = (rows: unknown): string => createHash("sha256").update(encode(rows)).digest("hex");

const first: ExtendedRow[] = [
  ["小明", "小明", "Xiao3 ming2", "name", ["John Doe (a placeholder name for young boys)"]],
  ["热可可", "熱可可", "re4 ke3 ke3", "noun", ["hot cocoa"]],
];
const second: ExtendedRow[] = [["邻舍", "鄰舍", "lin2 she4", "noun", ["neighbor"]]];
const replaced: ExtendedRow[] = [
  ["左邻右舍", "左鄰右舍", "zuo3 lin2 you4 she4", "phrase", ["neighbors"]],
];

const files = (shards: readonly (readonly [string, ExtendedRow[]])[]) => {
  const index: OnDemandIndex = {
    version: shards.map(([, rows]) => hash(rows)).join(":"),
    files: shards.map(([name, rows]) => ({
      name,
      sha256: hash(rows),
      rows: rows.length,
      bytes: encode(rows).length,
    })),
  };
  return new Map([
    ["wiktionary-zh/index.json", encode(index)],
    ...shards.map(([name, rows]) => [`wiktionary-zh/${name}`, encode(rows)] as const),
  ]);
};

const v1 = files([
  ["words-000.json", first],
  ["words-001.json", second],
]);
const v2 = files([
  ["words-000.json", first],
  ["words-001.json", replaced],
]);

const server =
  (served: Map<string, Uint8Array<ArrayBuffer>>, requests: string[] = []): FetchFile =>
  (name) => {
    requests.push(name);
    const bytes = served.get(name);
    return Promise.resolve(bytes ? ok(bytes) : err("HTTP 404"));
  };

let db: Database;
let counter = 0;

beforeEach(() => {
  counter += 1;
  db = openDatabase(`extended-test-${String(counter)}`);
});

describe("importExtendedLexicon", () => {
  it("imports every file, then looks words up by their simplified form", async () => {
    const progress: ImportProgress[] = [];
    expect(
      await importExtendedLexicon(db, server(v1), (step) => {
        progress.push(step);
      }),
    ).toEqual(ok(null));
    expect(progress).toEqual([
      { rows: 0, total: 3 },
      { rows: 2, total: 3 },
      { rows: 3, total: 3 },
    ]);
    expect(await lookupExtended(db, "热可可")).toEqual(
      ok([
        {
          simplified: "热可可",
          traditional: "熱可可",
          reading: "re4 ke3 ke3",
          pos: "noun",
          glosses: ["hot cocoa"],
        },
      ]),
    );
    expect(await lookupExtended(db, "熱可可")).toEqual(ok([]));
  });

  it("resumes an interrupted import without fetching finished files again", async () => {
    const broken = new Map(v1);
    broken.delete("wiktionary-zh/words-001.json");
    expect(await importExtendedLexicon(db, server(broken), () => null)).toEqual(
      err({ kind: "network", file: "wiktionary-zh/words-001.json", message: "HTTP 404" }),
    );
    const requests: string[] = [];
    expect(await importExtendedLexicon(db, server(v1, requests), () => null)).toEqual(ok(null));
    expect(requests).toEqual(["wiktionary-zh/index.json", "wiktionary-zh/words-001.json"]);
    expect(await db.extendedWords.count()).toBe(3);
  });

  it("replaces only the files a new version changes", async () => {
    await importExtendedLexicon(db, server(v1), () => null);
    const requests: string[] = [];
    expect(await importExtendedLexicon(db, server(v2, requests), () => null)).toEqual(ok(null));
    expect(requests).toEqual(["wiktionary-zh/index.json", "wiktionary-zh/words-001.json"]);
    expect(await lookupExtended(db, "邻舍")).toEqual(ok([]));
    const words = await lookupExtended(db, "左邻右舍");
    expect(words.ok && words.value.map((word) => word.glosses)).toEqual([["neighbors"]]);
    expect(await db.extendedWords.count()).toBe(3);
  });

  it("fetches only the index once the import is complete", async () => {
    await importExtendedLexicon(db, server(v1), () => null);
    const requests: string[] = [];
    expect(await importExtendedLexicon(db, server(v1, requests), () => null)).toEqual(ok(null));
    expect(requests).toEqual(["wiktionary-zh/index.json"]);
  });

  it("rejects a file that does not match its sha256", async () => {
    const tampered = new Map(v1);
    tampered.set("wiktionary-zh/words-001.json", encode(replaced));
    expect(await importExtendedLexicon(db, server(tampered), () => null)).toEqual(
      err({ kind: "integrity", file: "wiktionary-zh/words-001.json" }),
    );
  });

  it("works offline once complete, and says so when it never was", async () => {
    const offline = server(new Map());
    expect(await importExtendedLexicon(db, offline, () => null)).toEqual(
      err({ kind: "network", file: "wiktionary-zh/index.json", message: "HTTP 404" }),
    );
    await importExtendedLexicon(db, server(v1), () => null);
    expect(await importExtendedLexicon(db, offline, () => null)).toEqual(ok(null));
  });

  it("is not part of the first-run import, and survives a new dictionary version", async () => {
    const dictionary: DataIndex = {
      version: "v1",
      files: [{ name: "lexicon.json", kind: "lexicon", sha256: hash(["电话"]), rows: 1 }],
    };
    const requests: string[] = [];
    const main = server(
      new Map([
        ["index.json", encode(dictionary)],
        ["lexicon.json", encode(["电话"])],
      ]),
      requests,
    );
    await importExtendedLexicon(db, server(v1), () => null);
    expect(await importData(db, main, () => null)).toEqual(ok(null));
    expect(requests).toEqual(["index.json", "lexicon.json"]);
    expect(await importExtendedLexicon(db, server(new Map()), () => null)).toEqual(ok(null));
    expect(await db.extendedWords.count()).toBe(3);
  });
});
