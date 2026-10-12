import "fake-indexeddb/auto";
import { createHash } from "node:crypto";
import { err, ok } from "@openlinguo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createI18n } from "../i18n/index.ts";
import { openDatabase, type Database } from "./database.ts";
import { importExtendedLexicon } from "./extended-lexicon.ts";
import type { NameRow, OnDemandIndex } from "./format.ts";
import type { FetchFile } from "./import.ts";
import { importNames, lookupNameKinds, nameProposalKey } from "./names.ts";

const encode = (value: unknown): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(JSON.stringify(value));
const hash = (rows: unknown): string => createHash("sha256").update(encode(rows)).digest("hex");

const rows: NameRow[] = [
  ["乌兰察布", "place"],
  ["张三丰", "person"],
  ["阿姆斯特丹", "name"],
  ["阿姆斯特丹", "place"],
];
const index: OnDemandIndex = {
  version: hash(rows),
  files: [{ name: "names-000.json", sha256: hash(rows), rows: rows.length }],
};
const served = new Map([
  ["jieba-names/index.json", encode(index)],
  ["jieba-names/names-000.json", encode(rows)],
]);

const server =
  (files: Map<string, Uint8Array<ArrayBuffer>>, requests: string[] = []): FetchFile =>
  (name) => {
    requests.push(name);
    const bytes = files.get(name);
    return Promise.resolve(bytes ? ok(bytes) : err("HTTP 404"));
  };

let db: Database;
let counter = 0;

beforeEach(() => {
  counter += 1;
  db = openDatabase(`names-test-${String(counter)}`);
});

describe("importNames", () => {
  it("imports the names, then proposes every kind of an exact sequence", async () => {
    const requests: string[] = [];
    expect(await importNames(db, server(served, requests), () => null)).toEqual(ok(null));
    expect(requests).toEqual(["jieba-names/index.json", "jieba-names/names-000.json"]);
    expect(await lookupNameKinds(db, "张三丰")).toEqual(ok(["person"]));
    expect(await lookupNameKinds(db, "阿姆斯特丹")).toEqual(ok(["name", "place"]));
    expect(await lookupNameKinds(db, "张三")).toEqual(ok([]));
  });

  it("works offline once complete, and says so when it never was", async () => {
    const offline = server(new Map());
    expect(await importNames(db, offline, () => null)).toEqual(
      err({ kind: "network", file: "jieba-names/index.json", message: "HTTP 404" }),
    );
    await importNames(db, server(served), () => null);
    expect(await importNames(db, offline, () => null)).toEqual(ok(null));
  });

  it("is versioned apart from the extended lexicon", async () => {
    await importNames(db, server(served), () => null);
    expect(await importExtendedLexicon(db, server(new Map()), () => null)).toEqual(
      err({ kind: "network", file: "wiktionary-zh/index.json", message: "HTTP 404" }),
    );
  });
});

describe("nameProposalKey", () => {
  it("labels each kind as a probability in both languages", () => {
    const fr = createI18n("fr");
    const en = createI18n("en");
    expect(fr.t(nameProposalKey("person"))).toBe("Nom de personne probable");
    expect(en.t(nameProposalKey("organization"))).toBe("Probable organization name");
    for (const kind of ["person", "place", "organization", "name"] as const) {
      expect(en.t(nameProposalKey(kind))).toMatch(/^Probable /u);
      expect(fr.t(nameProposalKey(kind))).toMatch(/ probable$/u);
    }
  });
});
