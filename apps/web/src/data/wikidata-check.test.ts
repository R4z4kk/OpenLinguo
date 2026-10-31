import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import found from "../../../../packages/core/src/testing/wikidata-responses/found.json?raw";
import homonyms from "../../../../packages/core/src/testing/wikidata-responses/homonyms.json?raw";
import nothing from "../../../../packages/core/src/testing/wikidata-responses/nothing.json?raw";
import { openDatabase, type Database } from "./database.ts";
import { fromCache, type UnknownWord } from "./unknown-words.ts";
import {
  checkOnWikidata,
  foundOf,
  markWikidataNoticeSeen,
  toCheck,
  wikidataNoticeSeen,
} from "./wikidata-check.ts";
import { markNoticeSeen, noticeSeen } from "./ai-notice.ts";

const NOW = Date.UTC(2026, 9, 24);

const Recording = z.object({
  exchanges: z.array(z.object({ response: z.object({ body: z.unknown() }) })).min(1),
});
const bodyOf = (raw: string): unknown =>
  Recording.parse(JSON.parse(raw)).exchanges[0]?.response.body;

const reply =
  (body: unknown, status = 200): typeof fetch =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

const word = (text: string, extra: Partial<UnknownWord> = {}): UnknownWord => ({
  text,
  start: 0,
  end: text.length,
  compositional: false,
  before: "",
  after: "",
  wikidata: true,
  proposals: [],
  checks: [],
  ...extra,
});

let db: Database;
let counter = 0;
const signal = new AbortController().signal;

beforeEach(() => {
  counter += 1;
  db = openDatabase(`wikidata-check-test-${String(counter)}`);
});

describe("toCheck", () => {
  it("sends the eligible sequences that Wikidata has not answered, found or not", () => {
    const answered = { source: "wikidata", checkedAt: NOW, found: 0 } as const;
    expect(
      toCheck([
        word("王小红"),
        word("王芳", { checks: [answered] }),
        word("我很好", { wikidata: false }),
        word("周杰伦", { checks: [{ source: "ai", checkedAt: NOW, found: 1 }] }),
      ]),
    ).toEqual(["王小红", "周杰伦"]);
  });
});

describe("foundOf", () => {
  const candidate = {
    id: "Q42",
    kind: "person",
    descriptionFr: "chanteuse",
    descriptionEn: "singer",
  } as const;

  it("keeps the item id and takes the description in the interface language", () => {
    expect(foundOf(candidate, "fr")).toEqual({
      kind: "person",
      reading: null,
      gloss: "chanteuse",
      reference: "Q42",
      provenance: null,
    });
    expect(foundOf(candidate, "en").gloss).toBe("singer");
  });

  it("falls back to the other language, then to no gloss", () => {
    expect(foundOf({ ...candidate, descriptionFr: null }, "fr").gloss).toBe("singer");
    expect(foundOf({ ...candidate, descriptionEn: null }, "en").gloss).toBe("chanteuse");
    expect(
      foundOf({ ...candidate, descriptionFr: null, descriptionEn: null }, "en").gloss,
    ).toBeNull();
  });

  it("proposes a name for an item that is neither a person, a place nor an organization", () => {
    expect(foundOf({ ...candidate, kind: "other" }, "en").kind).toBe("name");
    expect(foundOf({ ...candidate, kind: "place" }, "en").kind).toBe("place");
    expect(foundOf({ ...candidate, kind: "organization" }, "en").kind).toBe("organization");
  });
});

describe("checkOnWikidata", () => {
  it("keeps the answer of every sequence, dated, with its results as proposals", async () => {
    const outcome = await checkOnWikidata(db, ["王芳"], "fr", signal, NOW, reply(bodyOf(homonyms)));
    expect(outcome).toEqual({ ok: true, value: { answered: ["王芳"], found: 1, error: null } });
    const [row] = await db.resolutions.toArray();
    expect(row).toMatchObject({ sequence: "王芳", source: "wikidata", checkedAt: NOW });
    expect(row?.found.length).toBeGreaterThan(5);
    expect(row?.found.every(({ reference }) => /^Q\d+$/u.test(reference ?? ""))).toBe(true);
    expect(new Set(row?.found.map(({ reference }) => reference)).size).toBe(row?.found.length);
  });

  it("keeps what was found and what was not, so neither is sent again", async () => {
    await checkOnWikidata(
      db,
      ["周杰伦", "张家界", "王小红"],
      "en",
      signal,
      NOW,
      reply(bodyOf(found)),
    );
    const rows = await db.resolutions.toArray();
    expect(rows.map(({ sequence }) => sequence).toSorted()).toEqual(
      ["张家界", "周杰伦", "王小红"].toSorted(),
    );
    expect(rows.find(({ sequence }) => sequence === "王小红")?.found).toEqual([]);
    expect(rows.find(({ sequence }) => sequence === "周杰伦")?.found.length).toBeGreaterThan(0);

    const cached = await fromCache(db, ["王小红", "周杰伦"]);
    if (!cached.ok) throw new Error(cached.error.kind);
    expect(cached.value.get("王小红")).toEqual({
      proposals: [],
      checks: [{ source: "wikidata", checkedAt: NOW, found: 0 }],
    });
  });

  it("keeps a sequence with nothing as an answer of its own", async () => {
    const outcome = await checkOnWikidata(
      db,
      ["王小红"],
      "en",
      signal,
      NOW,
      reply(bodyOf(nothing)),
    );
    expect(outcome).toEqual({ ok: true, value: { answered: ["王小红"], found: 0, error: null } });
    expect(await db.resolutions.get(["王小红", "wikidata"])).toEqual({
      sequence: "王小红",
      source: "wikidata",
      found: [],
      checkedAt: NOW,
    });
  });

  it("keeps the batches answered before a 429 and sends nothing after it", async () => {
    const sequences = Array.from({ length: 51 }, (_, index) =>
      String.fromCodePoint(0x4e00 + index * 2, 0x4e01 + index * 2),
    );
    const calls = vi.fn<typeof fetch>();
    calls.mockResolvedValueOnce(new Response(JSON.stringify(bodyOf(nothing)), { status: 200 }));
    calls.mockResolvedValue(new Response("slow down", { status: 429 }));
    const outcome = await checkOnWikidata(db, sequences, "en", signal, NOW, calls);
    expect(outcome).toEqual({
      ok: true,
      value: {
        answered: sequences.slice(0, 50),
        found: 0,
        error: { kind: "rate-limited", status: 429, message: null },
      },
    });
    expect(await db.resolutions.count()).toBe(50);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("keeps nothing and sends nothing for a sequence the query cannot hold", async () => {
    const send = vi.fn<typeof fetch>();
    const outcome = await checkOnWikidata(db, ['王"芳'], "en", signal, NOW, send);
    expect(outcome).toMatchObject({
      ok: true,
      value: { answered: [], error: { kind: "invalid-input" } },
    });
    expect(send).not.toHaveBeenCalled();
    expect(await db.resolutions.count()).toBe(0);
  });

  it("returns a storage failure instead of throwing", async () => {
    vi.spyOn(db.resolutions, "put").mockRejectedValueOnce(new Error("QuotaExceededError"));
    expect(
      await checkOnWikidata(db, ["王小红"], "en", signal, NOW, reply(bodyOf(nothing))),
    ).toEqual({
      ok: false,
      error: { kind: "storage", message: "Error: QuotaExceededError" },
    });
  });
});

describe("the Wikidata notice", () => {
  it("is remembered apart from the AI notice", async () => {
    expect(await wikidataNoticeSeen(db)).toEqual({ ok: true, value: false });
    expect(await markWikidataNoticeSeen(db)).toEqual({ ok: true, value: null });
    expect(await wikidataNoticeSeen(db)).toEqual({ ok: true, value: true });
    expect(await noticeSeen(db)).toEqual({ ok: true, value: false });
    await markNoticeSeen(db);
    expect(await noticeSeen(db)).toEqual({ ok: true, value: true });
  });

  it("reports a storage failure instead of throwing", async () => {
    vi.spyOn(db.aiNotice, "put").mockRejectedValueOnce(new Error("QuotaExceededError"));
    expect(await markWikidataNoticeSeen(db)).toEqual({
      ok: false,
      error: { kind: "storage", message: "Error: QuotaExceededError" },
    });
  });
});
