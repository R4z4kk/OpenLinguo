import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { err, ok } from "@openlinguo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "./database.ts";
import type { ExtendedRow, NameRow, OnDemandIndex } from "./format.ts";
import type { FetchFile } from "./import.ts";
import { installLists, listsStatus, removeLists } from "./local-lists.ts";

const encode = (value: unknown): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(JSON.stringify(value));
const hash = (rows: unknown): string => createHash("sha256").update(encode(rows)).digest("hex");

const words: ExtendedRow[] = [["热可可", "熱可可", "re4 ke3 ke3", "noun", ["hot cocoa"]]];
const names: NameRow[] = [["王小红", "person"]];

const dataset = (dir: string, file: string, rows: unknown[]) => {
  const index: OnDemandIndex = {
    version: hash(rows),
    files: [{ name: file, sha256: hash(rows), rows: rows.length, bytes: encode(rows).length }],
  };
  return [
    [`${dir}/index.json`, encode(index)],
    [`${dir}/${file}`, encode(rows)],
  ] as const;
};
const served = new Map([
  ...dataset("wiktionary-zh", "words-000.json", words),
  ...dataset("jieba-names", "names-000.json", names),
]);
const SIZE = encode(words).length + encode(names).length;

const server =
  (files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>, requests: string[] = []): FetchFile =>
  (name) => {
    requests.push(name);
    const bytes = files.get(name);
    return Promise.resolve(bytes ? ok(bytes) : err("HTTP 404"));
  };

let db: Database;
let counter = 0;

beforeEach(() => {
  counter += 1;
  db = openDatabase(`local-lists-test-${String(counter)}`);
});

describe("listsStatus", () => {
  it("gives the size of both lists before anything is downloaded", async () => {
    expect(await listsStatus(db, server(served))).toEqual(ok({ state: "absent", bytes: SIZE }));
  });

  it("knows the lists are installed, and offline too", async () => {
    await installLists(db, server(served), () => null, new AbortController().signal);
    expect(await listsStatus(db, server(served))).toEqual(ok({ state: "installed", bytes: SIZE }));
    expect(await listsStatus(db, server(new Map()))).toEqual(
      ok({ state: "installed", bytes: null }),
    );
  });

  it("calls an interrupted download partial, and an installed list that has a new version too", async () => {
    const broken = new Map(served);
    broken.delete("jieba-names/names-000.json");
    await installLists(db, server(broken), () => null, new AbortController().signal);
    expect(await listsStatus(db, server(served))).toEqual(ok({ state: "partial", bytes: SIZE }));

    await installLists(db, server(served), () => null, new AbortController().signal);
    const renewed = new Map([
      ...served,
      ...dataset("jieba-names", "names-000.json", [["李明", "person"]]),
    ]);
    const status = await listsStatus(db, server(renewed));
    expect(status.ok && status.value.state).toBe("partial");
  });

  it("cannot say the size when the lists cannot be reached", async () => {
    expect(await listsStatus(db, server(new Map()))).toEqual(ok({ state: "absent", bytes: null }));
  });
});

describe("installLists", () => {
  it("downloads both lists and reports the bytes done over the bytes of the two", async () => {
    const progress: [number, number][] = [];
    const result = await installLists(
      db,
      server(served),
      (received, total) => progress.push([received, total]),
      new AbortController().signal,
    );
    expect(result).toEqual(ok(null));
    expect(progress.at(-1)).toEqual([SIZE, SIZE]);
    expect(progress.map(([received]) => received)).toEqual(
      progress.map(([received]) => received).toSorted((a, b) => a - b),
    );
    expect(await db.extendedWords.count()).toBe(1);
    expect(await db.names.count()).toBe(1);
  });

  it("stops at the next file once cancelled", async () => {
    const controller = new AbortController();
    const requests: string[] = [];
    const result = await installLists(
      db,
      server(served, requests),
      () => {
        controller.abort();
      },
      controller.signal,
    );
    expect(result).toEqual(err({ kind: "cancelled" }));
    expect(await db.names.count()).toBe(0);
  });

  it("reports the file that failed", async () => {
    const broken = new Map(served);
    broken.delete("wiktionary-zh/words-000.json");
    expect(
      await installLists(db, server(broken), () => null, new AbortController().signal),
    ).toEqual(err({ kind: "network", file: "wiktionary-zh/words-000.json", message: "HTTP 404" }));
  });
});

describe("removeLists", () => {
  it("deletes the rows and the versions, so the lists can be downloaded again", async () => {
    await installLists(db, server(served), () => null, new AbortController().signal);
    expect(await removeLists(db)).toEqual(ok(null));
    expect(await listsStatus(db, server(served))).toEqual(ok({ state: "absent", bytes: SIZE }));
    expect(await db.extendedWords.count()).toBe(0);
  });
});
