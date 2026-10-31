import "fake-indexeddb/auto";
import type { LibraryItem, LibrarySummary } from "@openlinguo/core/submission";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "./database.ts";
import { importLibraryItem, libraryPath, listLibrary, loadLibraryItem } from "./global-library.ts";
import { MAX_TEXT_CHARACTERS } from "./texts.ts";

const AT = Date.UTC(2026, 9, 31, 20);

const provenance = {
  origin: "ai",
  provider: "groq",
  model: "llama-3.3-70b-versatile",
  promptVersion: "zh-story-v1",
  createdAt: "2026-10-30T09:00:00.000Z",
} as const;

const summary: LibrarySummary = {
  id: "6f1f3c8e-2f0b-4c8e-9a52-0b6f3b3c1a01",
  title: "我的猫",
  attribution: "小明",
  origin: "human",
  provenance: null,
  licence: "CC-BY-SA-4.0",
  band: 2,
  publishedAt: "2026-10-31T12:00:00.000Z",
};
const item: LibraryItem = { ...summary, body: "我的猫很可爱。" };

const fetched: string[] = [];
const answer = (status: number, body: unknown) => {
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) => {
      fetched.push(path);
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
};

let db: Database;
let counter = 0;
beforeEach(() => {
  counter += 1;
  db = openDatabase(`global-library-test-${String(counter)}`);
  fetched.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("libraryPath", () => {
  it("leaves out the parameters not set", () => {
    expect(libraryPath({ band: null, page: null })).toBe("/api/library");
    expect(libraryPath({ band: 3, page: null })).toBe("/api/library?band=3");
    expect(libraryPath({ band: 3, page: 2 })).toBe("/api/library?band=3&page=2");
  });
});

describe("listLibrary", () => {
  it("reads a page of the library", async () => {
    answer(200, { items: [summary], nextPage: 2 });
    expect(await listLibrary({ band: 2, page: null })).toEqual({
      ok: true,
      value: { items: [summary], nextPage: 2 },
    });
    expect(fetched).toEqual(["/api/library?band=2"]);
  });

  it("treats an answer that is not a page as unexpected", async () => {
    answer(200, { items: [{ ...summary, band: null }], nextPage: null });
    expect(await listLibrary({ band: null, page: null })).toEqual({
      ok: false,
      error: { kind: "unexpected", status: 200 },
    });
  });

  it("says when the device is offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    expect(await listLibrary({ band: null, page: null })).toEqual({
      ok: false,
      error: { kind: "offline" },
    });
  });
});

describe("loadLibraryItem", () => {
  it("reads a text, and a text no longer published as refused", async () => {
    answer(200, item);
    expect(await loadLibraryItem(item.id)).toEqual({ ok: true, value: item });
    expect(fetched).toEqual([`/api/library/${item.id}`]);
    answer(404, { code: "NOT_FOUND", message: "No such text in the library" });
    expect(await loadLibraryItem(item.id)).toEqual({
      ok: false,
      error: { kind: "refused", code: "NOT_FOUND" },
    });
  });
});

describe("importLibraryItem", () => {
  it("copies the text with its licence and attribution, under the library's id", async () => {
    const imported = await importLibraryItem(db, item, AT);
    const copy = {
      id: item.id,
      title: "我的猫",
      body: "我的猫很可爱。",
      source: "library",
      createdAt: AT,
      provenance: null,
      readingChoices: {},
      library: {
        licence: "CC-BY-SA-4.0",
        attribution: "小明",
        publishedAt: "2026-10-31T12:00:00.000Z",
      },
    };
    expect(imported).toEqual({ ok: true, value: copy });
    expect(await db.texts.get(item.id)).toEqual(copy);
  });

  it("keeps a story's provenance, so its AI badge follows it", async () => {
    const story: LibraryItem = {
      ...item,
      origin: "ai",
      provenance,
      licence: "CC0-1.0",
      attribution: null,
    };
    expect(await importLibraryItem(db, story, AT)).toMatchObject({
      ok: true,
      value: { provenance, library: { licence: "CC0-1.0", attribution: null } },
    });
  });

  it("keeps the first copy when the text is imported again", async () => {
    await importLibraryItem(db, item, AT);
    await db.texts.update(item.id, { readingChoices: { 2: "mao1" } });
    expect(await importLibraryItem(db, item, AT + 1)).toMatchObject({
      ok: true,
      value: { createdAt: AT, readingChoices: { 2: "mao1" } },
    });
    expect(await db.texts.count()).toBe(1);
  });

  it("refuses a text longer than the device's limit", async () => {
    const long = { ...item, body: "好".repeat(MAX_TEXT_CHARACTERS + 1) };
    expect(await importLibraryItem(db, long, AT)).toMatchObject({
      ok: false,
      error: { kind: "too-long" },
    });
    expect(await db.texts.count()).toBe(0);
  });
});
