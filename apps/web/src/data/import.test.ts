import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { err, ok } from "@openlinguo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "./database.ts";
import type { DataFile, DataIndex, EntryRow } from "./format.ts";
import { importData, type FetchFile, type ImportProgress } from "./import.ts";

const encode = (value: unknown): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(JSON.stringify(value));

const entries: EntryRow[] = [
  ["电话", "dian4 hua4", "dian4 hua4", ["電話"], [["telephone"], ["téléphone"], []], 2, 1, true],
  ["话", "hua4", "hua4", ["話"], [["speech"], [], ["parole"]], 1, 1, true],
];
const more: EntryRow[] = [
  ["阿龙", "a5 long2", "a5 long2", ["阿龍"], [[], ["Aron"], []], null, null, false],
];

const files = (version: string): Map<string, Uint8Array<ArrayBuffer>> => {
  const contents: [string, DataFile["kind"], unknown[]][] = [
    ["characters.json", "characters", [["话", "⿰讠舌", "讠", null]]],
    ["lexicon.json", "lexicon", ["电话", "话"]],
    ["entries-000.json", "entries", entries],
    ["entries-001.json", "entries", more],
  ];
  const index: DataIndex = {
    version,
    files: contents.map(([name, kind, rows]) => ({
      name,
      kind,
      rows: rows.length,
      sha256: createHash("sha256").update(encode(rows)).digest("hex"),
    })),
  };
  return new Map([
    ["index.json", encode(index)],
    ...contents.map(([name, , rows]) => [name, encode(rows)] as const),
  ]);
};

const server =
  (served: Map<string, Uint8Array<ArrayBuffer>>, requests: string[]): FetchFile =>
  (name) => {
    requests.push(name);
    const bytes = served.get(name);
    return Promise.resolve(bytes ? ok(bytes) : err("HTTP 404"));
  };

let db: Database;
let counter = 0;

beforeEach(() => {
  counter += 1;
  db = openDatabase(`import-test-${String(counter)}`);
});

describe("importData", () => {
  it("imports every file and reports progress in rows", async () => {
    const progress: ImportProgress[] = [];
    const result = await importData(db, server(files("v1"), []), (step) => {
      progress.push(step);
    });
    expect(result).toEqual(ok(null));
    expect(await db.entries.count()).toBe(3);
    expect((await db.entries.get("电话\tdian4 hua4"))?.glosses).toEqual([
      ["telephone"],
      ["téléphone"],
      [],
    ]);
    expect((await db.characters.get("话"))?.decomposition).toBe("⿰讠舌");
    expect(await db.meta.get("lexicon")).toEqual({ key: "lexicon", value: ["电话", "话"] });
    expect(progress.at(0)).toEqual({ rows: 0, total: 6 });
    expect(progress.at(-1)).toEqual({ rows: 6, total: 6 });
  });

  it("resumes an interrupted import without fetching finished files again", async () => {
    const served = files("v1");
    const broken = new Map(served);
    broken.delete("entries-001.json");
    expect(await importData(db, server(broken, []), () => null)).toEqual(
      err({ kind: "network", file: "entries-001.json", message: "HTTP 404" }),
    );
    const requests: string[] = [];
    expect(await importData(db, server(served, requests), () => null)).toEqual(ok(null));
    expect(requests).toEqual(["index.json", "entries-001.json"]);
    expect(await db.entries.count()).toBe(3);
  });

  it("refuses a file whose content does not match its hash", async () => {
    const served = files("v1");
    served.set("entries-000.json", encode(more));
    expect(await importData(db, server(served, []), () => null)).toEqual(
      err({ kind: "integrity", file: "entries-000.json" }),
    );
  });

  it("skips the work when the version is already imported, replaces it otherwise", async () => {
    await importData(db, server(files("v1"), []), () => null);
    const requests: string[] = [];
    await importData(db, server(files("v1"), requests), () => null);
    expect(requests).toEqual(["index.json"]);
    await db.entries.put({
      id: "stale",
      simplified: "stale",
      reading: "x",
      variants: [],
      glosses: [[], [], []],
      hsk2025: null,
      gf0025: null,
      lexicon: true,
    });
    expect(await importData(db, server(files("v2"), []), () => null)).toEqual(ok(null));
    expect(await db.entries.get("stale")).toBeUndefined();
    expect(await db.meta.get("dataVersion")).toEqual({ key: "dataVersion", value: "v2" });
  });

  it("reports a malformed index", async () => {
    const served = new Map([["index.json", encode({ version: "" })]]);
    const result = await importData(db, server(served, []), () => null);
    expect(result.ok || result.error.kind).toBe("format");
  });
});
