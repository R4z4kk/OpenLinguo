import "fake-indexeddb/auto";
import { randomBytes } from "node:crypto";
import {
  cardId,
  CURRENT_SCHEDULER,
  type Card,
  type CardKey,
  type Review,
  type WordKey,
} from "@openlinguo/core";
import { SYNC_HEADERS, SYNC_LIMITS } from "@openlinguo/core/sync";
import type { Table } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deckWordId, MY_WORDS, openDatabase, type Database, type StoredNote } from "./database.ts";
import { deleteDeck, fileWord, putCards } from "./decks.ts";
import { recordReview } from "./review-log.ts";
import { decodeChunk, SYNC_FORMAT, SYNC_VERSION } from "./sync-chunk.ts";
import { holdsChunks } from "./sync-client.ts";
import { SYNCED_TABLES } from "./sync-entities.ts";
import { clearWhenOff, forgetSync, syncNow, turnOff, turnOn } from "./sync.ts";
import { seedLearning } from "./test-support.ts";

const REFERENTIAL = "hsk-2025";
const ACCOUNT = "account";
const SMALL = "00000000-0000-4000-8000-00000000000a";
const LARGE = "00000000-0000-4000-8000-00000000000c";
const GOOD: WordKey = { headword: "好", readingKey: "hao3" };
const CAT: WordKey = { headword: "猫", readingKey: "mao1" };

const recall = (word: WordKey): Card => {
  const key: CardKey = { language: "zh", ...word, type: "recall" };
  return { ...key, id: cardId(key) };
};

let reviewCount = 0;
const reviewOf = (card: Card, reviewedAt: number): Review => {
  reviewCount += 1;
  return {
    id: `00000000-0000-4000-8000-${String(reviewCount).padStart(12, "0")}`,
    cardId: card.id,
    grade: "good",
    reviewedAt,
    utcOffsetMinutes: 60,
    scheduler: CURRENT_SCHEDULER,
    dailyGoal: 20,
    wordDone: null,
  };
};

const NOTE: StoredNote = {
  id: "note-1",
  characters: "你好",
  pinyin: "nǐ hǎo",
  meaning: "hello",
  updatedAt: 42,
  provenance: null,
};

type Stored = { readonly id: number; readonly bytes: Uint8Array };

/** The server of Task 1's contract, in memory: its routes, limits and refusals. */
type Store = {
  chunks: Stored[];
  nextId: number;
  quota: number;
  offline: boolean;
  /** Chunks stored whose answer is lost on the way back. */
  lostAnswers: number;
  calls: string[];
  /** The expected-oldest header of each push, `null` when absent. */
  expected: (string | null)[];
};

const newStore = (): Store => ({
  chunks: [],
  nextId: 1,
  quota: SYNC_LIMITS.accountBytes,
  offline: false,
  lostAnswers: 0,
  calls: [],
  expected: [],
});

const refuse = (status: number, code: string): Response =>
  new Response(JSON.stringify({ code, message: code }), { status });

const usageOf = (store: Store) => ({
  used: store.chunks.reduce((sum, { bytes }) => sum + bytes.length, 0),
  oldest: store.chunks[0]?.id ?? null,
});

const serve = (store: Store) => (input: string, init: RequestInit) => {
  const url = new URL(input, "http://localhost");
  const method = init.method ?? "GET";
  store.calls.push(method);
  if (store.offline) return Promise.reject(new TypeError("offline"));
  if (method === "POST") {
    if (!(init.body instanceof Uint8Array)) throw new Error("expected bytes");
    if (new Headers(init.headers).get("content-type") !== "application/gzip")
      return Promise.resolve(refuse(415, "INVALID_REQUEST"));
    const bytes = new Uint8Array(init.body);
    if (bytes.length > SYNC_LIMITS.chunkBytes)
      return Promise.resolve(refuse(413, "SYNC_CHUNK_TOO_LARGE"));
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b)
      return Promise.resolve(refuse(400, "INVALID_REQUEST"));
    const header = new Headers(init.headers).get(SYNC_HEADERS.expectedOldest);
    store.expected.push(header);
    if (header !== null && usageOf(store).oldest !== Number(header))
      return Promise.resolve(refuse(409, "SYNC_STORE_CHANGED"));
    if (usageOf(store).used + bytes.length > store.quota)
      return Promise.resolve(refuse(409, "SYNC_QUOTA"));
    const id = store.nextId;
    store.nextId += 1;
    store.chunks.push({ id, bytes });
    if (store.lostAnswers > 0) {
      store.lostAnswers -= 1;
      return Promise.reject(new TypeError("answer lost"));
    }
    const usage = usageOf(store);
    return Promise.resolve(
      new Response(
        JSON.stringify({ id, used: usage.used, limit: store.quota, oldest: usage.oldest }),
        {
          status: 201,
        },
      ),
    );
  }
  if (method === "DELETE") {
    store.chunks = [];
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  const after = Number(url.searchParams.get("after"));
  const usage = usageOf(store);
  const headers = new Headers();
  if (usage.oldest !== null) headers.set(SYNC_HEADERS.oldest, String(usage.oldest));
  const next = store.chunks.find(({ id }) => id > after) ?? null;
  if (next === null) {
    headers.set(SYNC_HEADERS.used, String(usage.used));
    return Promise.resolve(new Response(null, { status: 204, headers }));
  }
  headers.set(SYNC_HEADERS.id, String(next.id));
  return Promise.resolve(new Response(new Uint8Array(next.bytes), { status: 200, headers }));
};

/** Web Locks as a browser holds them: one holder at a time, the others wait or find it taken. */
const stubLocks = () => {
  const queues = new Map<string, Promise<unknown>>();
  const held = new Set<string>();
  const request = async (
    name: string,
    options: { readonly ifAvailable: boolean },
    callback: (lock: { readonly name: string } | null) => Promise<unknown>,
  ): Promise<unknown> => {
    if (options.ifAvailable && held.has(name)) return callback(null);
    const run = (queues.get(name) ?? Promise.resolve()).then(async () => {
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    });
    queues.set(
      name,
      run.catch(() => null),
    );
    return run;
  };
  vi.stubGlobal("navigator", { userAgent: "node", locks: { request } });
  return request;
};

const gzip = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );

const without = async (name: string, run: () => Promise<void>): Promise<void> => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, name);
  Reflect.deleteProperty(globalThis, name);
  try {
    await run();
  } finally {
    if (saved) Object.defineProperty(globalThis, name, saved);
  }
};

let counter = 0;
const opened: Database[] = [];
let store: Store;

const fresh = (): Database => {
  counter += 1;
  const db = openDatabase(`sync-test-${String(counter)}`);
  opened.push(db);
  return db;
};

const device = async (accountId = ACCOUNT): Promise<Database> => {
  const db = fresh();
  await db.syncState.put({ id: "state", accountId, cursor: 0, oldest: null, lastSyncAt: null });
  return db;
};

beforeEach(() => {
  store = newStore();
  vi.stubGlobal("fetch", serve(store));
  stubLocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const db of opened.splice(0)) db.close();
});

const at = (time: number): void => {
  vi.spyOn(Date, "now").mockReturnValue(time);
};

const seed = (db: Database, time: number, run: () => Promise<unknown>): Promise<unknown> => {
  at(time);
  return seedLearning(db, run);
};

const sync = async (db: Database) => {
  const result = await syncNow(db, ACCOUNT);
  if (!result.ok) throw new Error(`sync failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

const waitingCount = (db: Database): Promise<number> =>
  db.syncEntities.where("pending").equals(1).count();

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : 1);

/** Every synced table, whatever the key order of its rows. */
const tables = async (db: Database): Promise<Readonly<Record<string, readonly string[]>>> => {
  const rows: Record<string, string[]> = {};
  for (const table of SYNCED_TABLES)
    rows[table] = (await db.table<object>(table).toArray())
      .map((row) => JSON.stringify(Object.entries(row).sort()))
      .sort();
  return rows;
};

/** The tables, with what the device remembers of each entity but `pending`. */
const snapshot = async (db: Database) => ({
  tables: await tables(db),
  registers: (await db.syncEntities.toArray())
    .filter((row) => row.table !== "reviews")
    .sort(byId)
    .map(({ id, changedAt, deleted }) => ({ id, changedAt, deleted })),
});

const posted = async () =>
  Promise.all(
    store.chunks.map(async ({ bytes }) => {
      const decoded = await decodeChunk(bytes);
      if (!decoded.ok) throw new Error("a stored chunk does not decode");
      return decoded.value;
    }),
  );

const bigNote = (id: string, characters: number): StoredNote => ({
  ...NOTE,
  id,
  characters: randomBytes(Math.ceil((characters * 3) / 4)).toString("base64"),
});

const learn = async (db: Database, time: number): Promise<void> => {
  await seed(db, time, async () => {
    await db.decks.add({ id: SMALL, name: "Trips" });
    await db.notes.add(NOTE);
    await db.knownMarks.add({ ...CAT, markedAt: 1 });
  });
  at(time + 50);
  expect((await fileWord(db, SMALL, GOOD, true, REFERENTIAL)).ok).toBe(true);
  expect((await recordReview(db, reviewOf(recall(GOOD), Date.UTC(2026, 10, 3)))).ok).toBe(true);
};

describe("syncNow", () => {
  it("takes the usage from the answer with no chunk, not from a chunk", async () => {
    const a = await device();
    await learn(a, 100);
    await sync(a);
    const b = await device();

    expect(await sync(b)).toEqual({
      used: usageOf(store).used,
      limit: SYNC_LIMITS.accountBytes,
      oldest: 1,
    });
  });

  it("reads what it sends table by table, not row by row", async () => {
    const a = await device();
    await learn(a, 100);
    const gets = [a.reviews, a.decks, a.notes, a.knownMarks].map((table) =>
      vi.spyOn(table as Table<object, unknown>, "get"),
    );

    await sync(a);

    for (const get of gets) expect(get).not.toHaveBeenCalled();
    const [chunk] = await posted();
    expect(chunk?.reviews).toHaveLength(1);
    expect(chunk?.entities.map(({ table }) => table).sort()).toEqual([
      "cards",
      "cards",
      "deckWords",
      "decks",
      "knownMarks",
      "notes",
    ]);
  });

  it("turned on again, it does not send a review the store already holds", async () => {
    const a = await device();
    await learn(a, 100);
    await sync(a);
    const b = await device();
    await sync(b);
    const before = store.chunks.length;

    expect((await turnOn(b, ACCOUNT, 500)).ok).toBe(true);
    expect((await b.syncEntities.toArray()).some(({ table }) => table === "reviews")).toBe(true);
    await sync(b);

    expect((await b.syncEntities.toArray()).some(({ table }) => table === "reviews")).toBe(false);
    expect((await posted()).slice(before).flatMap(({ reviews }) => reviews)).toEqual([]);
  });

  it("receives before it sends", async () => {
    const a = await device();
    await learn(a, 100);
    await sync(a);
    const b = await device();
    await seed(b, 300, () => b.knownMarks.add({ ...GOOD, markedAt: 2 }));
    store.calls.length = 0;

    await sync(b);

    expect(store.calls).toEqual(["GET", "GET", "POST"]);
    expect(await b.decks.count()).toBe(1);
    expect(await b.notes.count()).toBe(1);
    expect(await b.knownMarks.count()).toBe(2);
    expect((await b.syncState.get("state"))?.cursor).toBe(1);
  });

  it("sends waiting rows, then clears them", async () => {
    const a = await device();
    await learn(a, 100);
    expect(await waitingCount(a)).toBeGreaterThan(0);

    const usage = await sync(a);

    expect(await waitingCount(a)).toBe(0);
    expect((await a.syncEntities.toArray()).filter(({ table }) => table === "reviews")).toEqual([]);
    expect(await a.syncEntities.get(`notes:${NOTE.id}`)).toMatchObject({ pending: 0 });
    expect(store.chunks).toHaveLength(1);
    expect(usage).toEqual({
      used: usageOf(store).used,
      limit: SYNC_LIMITS.accountBytes,
      oldest: 1,
    });
    expect((await a.syncState.get("state"))?.oldest).toBe(1);
    expect((await a.syncState.get("state"))?.lastSyncAt).toBe(150);
  });

  it("keeps a row changed while it was being sent waiting", async () => {
    const a = await device();
    await seed(a, 100, () => a.notes.add(NOTE));
    const base = serve(store);
    vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
      const answer = await base(input, init);
      if (init.method === "POST") await seed(a, 200, () => a.notes.put({ ...NOTE, meaning: "hi" }));
      return answer;
    });

    await sync(a);

    expect(await a.syncEntities.get(`notes:${NOTE.id}`)).toMatchObject({
      changedAt: 200,
      pending: 1,
    });
  });

  it("two devices converge through the store", async () => {
    const a = await device();
    const b = await device();
    await learn(a, 100);
    await sync(a);
    await sync(b);
    await seed(b, 300, async () => {
      await b.knownMarks.delete(["猫", "mao1"]);
      await b.notes.put({ ...NOTE, meaning: "from b", updatedAt: 300 });
    });
    at(310);
    expect((await fileWord(b, MY_WORDS, CAT, true, REFERENTIAL)).ok).toBe(true);
    expect((await recordReview(b, reviewOf(recall(CAT), Date.UTC(2026, 10, 3)))).ok).toBe(true);
    await seed(a, 320, () => a.knownMarks.add({ ...GOOD, markedAt: 3 }));
    await sync(b);
    await sync(a);
    await sync(b);

    expect(await snapshot(a)).toEqual(await snapshot(b));
    expect((await a.reviews.toArray()).map(({ id }) => id).sort()).toEqual(
      (await b.reviews.toArray()).map(({ id }) => id).sort(),
    );
    expect((await a.notes.get(NOTE.id))?.meaning).toBe("from b");
    expect(await a.knownMarks.count()).toBe(1);
    expect(await waitingCount(a)).toBe(0);
    expect(await waitingCount(b)).toBe(0);
  });

  it("splits what is over 262144 bytes into several chunks", async () => {
    const a = await device();
    const notes = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => bigNote(id, 100_000));
    await seed(a, 100, () => a.notes.bulkAdd(notes));

    await sync(a);

    expect(store.chunks.length).toBeGreaterThan(1);
    for (const { bytes } of store.chunks)
      expect(bytes.length).toBeLessThanOrEqual(SYNC_LIMITS.chunkBytes);
    const b = await device();
    await sync(b);
    expect(await tables(b)).toEqual(await tables(a));
    expect(await waitingCount(a)).toBe(0);
  });

  it("sends a batch's deck words no later than its notes, halving included", async () => {
    const a = await device();
    await seed(a, 100, async () => {
      await a.decks.add({ id: SMALL, name: "Trips" });
      await a.notes.bulkAdd(["a", "b", "c", "d", "e", "f"].map((id) => bigNote(id, 100_000)));
      await a.deckWords.bulkAdd(
        ["x", "y", "z"].map((note) => ({
          note,
          id: deckWordId(SMALL, { note }),
          deckId: SMALL,
        })),
      );
    });

    await sync(a);

    const tablesSent = (await posted()).flatMap(({ entities }) =>
      entities.map(({ table }) => table),
    );
    expect(tablesSent.lastIndexOf("deckWords")).toBeLessThan(tablesSent.indexOf("notes"));
    expect(store.chunks.length).toBeGreaterThan(1);
  });

  it("sends a deck word gone with its deck, which has no row, from its key", async () => {
    const a = await device();
    await learn(a, 100);
    await sync(a);
    const b = await device();
    await sync(b);
    at(400);
    expect((await deleteDeck(b, SMALL, REFERENTIAL)).ok).toBe(true);
    await sync(b);
    await seed(a, 450, () =>
      a.deckWords.put({ ...GOOD, id: deckWordId(SMALL, GOOD), deckId: SMALL }),
    );

    await sync(a);

    expect(await a.deckWords.count()).toBe(0);
    expect(await a.syncEntities.get(`deckWords:${deckWordId(SMALL, GOOD)}`)).toMatchObject({
      deleted: false,
      pending: 0,
    });
    const c = await device();
    await sync(c);
    expect(await c.deckWords.count()).toBe(0);
    expect(await c.decks.count()).toBe(0);
    expect(await c.syncEntities.get(`deckWords:${deckWordId(SMALL, GOOD)}`)).toMatchObject({
      deleted: false,
      changedAt: 450,
    });
  });

  it("an entity too large alone stops with entity-too-large, and others stay waiting", async () => {
    const a = await device();
    await learn(a, 100);
    await seed(a, 200, () => a.notes.put(bigNote("big", 400_000)));
    const waiting = await waitingCount(a);

    const result = await syncNow(a, ACCOUNT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "entity-too-large", entityId: "notes:big" },
    });
    expect(store.calls).not.toContain("POST");
    expect(await waitingCount(a)).toBe(waiting);
  });

  it("a row that fails validation stops the send with a failure naming it", async () => {
    const a = await device();
    await seed(a, 100, async () => {
      await a.notes.add(NOTE);
      await a.knownMarks.add({ ...CAT, markedAt: 1 });
    });
    await a.syncEntities.put({
      id: "knownMarks:broken",
      table: "knownMarks",
      key: "broken",
      changedAt: 1,
      deleted: false,
      pending: 1,
    });

    const result = await syncNow(a, ACCOUNT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid-row", entityId: "knownMarks:broken" },
    });
    expect(store.calls).not.toContain("POST");
    expect(await waitingCount(a)).toBe(3);
  });

  it.each([
    [
      "a review",
      "reviews",
      `reviews:00000000-0000-4000-8000-0000000000ff`,
      "00000000-0000-4000-8000-0000000000ff",
    ],
    ["a deck", "decks", "decks:gone", "gone"],
    ["a note", "notes", "notes:gone", "gone"],
    [
      "a known mark",
      "knownMarks",
      `knownMarks:${JSON.stringify(["猫", "mao1"])}`,
      JSON.stringify(["猫", "mao1"]),
    ],
  ] as const)(
    "%s waiting live with no stored value stops the send, and nothing is marked sent",
    async (_name, table, id, key) => {
      const a = await device();
      await seed(a, 100, () => a.notes.add(NOTE));
      await a.syncEntities.put({ id, table, key, changedAt: 1, deleted: false, pending: 1 });

      const result = await syncNow(a, ACCOUNT);

      expect(result).toEqual({
        ok: false,
        error: { kind: "invalid-row", entityId: id },
      });
      expect(store.calls).not.toContain("POST");
      expect(await waitingCount(a)).toBe(2);
    },
  );

  it("an unreadable chunk stops there, cursor unmoved, sending not attempted", async () => {
    const a = await device();
    await seed(a, 100, () => a.notes.add(NOTE));
    store.chunks.push({ id: 1, bytes: new Uint8Array([0x1f, 0x8b, 1, 2, 3]) });
    store.nextId = 2;

    const result = await syncNow(a, ACCOUNT);

    expect(result).toEqual({ ok: false, error: { kind: "unreadable-chunk", chunkId: 1 } });
    expect((await a.syncState.get("state"))?.cursor).toBe(0);
    expect(store.calls).not.toContain("POST");
    expect(await waitingCount(a)).toBe(1);
  });

  it("a newer format likewise", async () => {
    const a = await device();
    await seed(a, 100, () => a.notes.add(NOTE));
    const bytes = await gzip(
      JSON.stringify({ format: SYNC_FORMAT, version: SYNC_VERSION + 1, reviews: [], entities: [] }),
    );
    store.chunks.push({ id: 1, bytes });
    store.nextId = 2;

    const result = await syncNow(a, ACCOUNT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "newer-format", version: SYNC_VERSION + 1 },
    });
    expect((await a.syncState.get("state"))?.cursor).toBe(0);
    expect(store.calls).not.toContain("POST");
  });

  it("offline keeps everything waiting", async () => {
    const a = await device();
    await learn(a, 100);
    const waiting = await waitingCount(a);
    store.offline = true;

    const result = await syncNow(a, ACCOUNT);

    expect(result).toEqual({ ok: false, error: { kind: "api", failure: { kind: "offline" } } });
    expect(await waitingCount(a)).toBe(waiting);
    store.offline = false;
    await sync(a);
    expect(await waitingCount(a)).toBe(0);
  });

  it("a quota refusal stops sending, receiving still ran", async () => {
    const a = await device();
    await learn(a, 100);
    await sync(a);
    const b = await device();
    await seed(b, 300, () => b.knownMarks.add({ ...GOOD, markedAt: 2 }));
    store.quota = usageOf(store).used + 10;

    const result = await syncNow(b, ACCOUNT);

    expect(result).toEqual({
      ok: false,
      error: { kind: "api", failure: { kind: "refused", code: "SYNC_QUOTA" } },
    });
    expect(await b.decks.count()).toBe(1);
    expect((await b.syncState.get("state"))?.cursor).toBe(1);
    expect(await b.syncEntities.get(`knownMarks:${JSON.stringify(["好", "hao3"])}`)).toMatchObject({
      pending: 1,
    });
  });

  it("the oldest chunk changing stops with turned-off-elsewhere", async () => {
    const a = await device();
    const b = await device();
    await learn(a, 100);
    await sync(a);
    await sync(b);
    expect((await turnOff(b)).ok).toBe(true);
    await seed(a, 300, () => a.knownMarks.add({ ...GOOD, markedAt: 2 }));

    const result = await syncNow(a, ACCOUNT);

    expect(result).toEqual({ ok: false, error: { kind: "turned-off-elsewhere" } });
    expect(store.calls.at(-1)).toBe("GET");
    expect(await waitingCount(a)).toBe(1);
  });

  it("turned on again, it uploads everything", async () => {
    const a = await device();
    await learn(a, 100);
    await sync(a);
    const b = await device();
    await sync(b);
    expect((await turnOff(b)).ok).toBe(true);
    expect((await syncNow(a, ACCOUNT)).ok).toBe(false);

    at(500);
    expect((await turnOn(a, ACCOUNT, 500)).ok).toBe(true);
    await sync(a);

    const c = await device();
    await sync(c);
    expect(await tables(c)).toEqual(await tables(a));
    expect(await c.reviews.count()).toBe(1);
    expect(await waitingCount(a)).toBe(0);
  });

  it("a store deleted between the pull and the push stops with turned-off-elsewhere, leaving nothing on the server", async () => {
    const a = await device();
    await learn(a, 100);
    await sync(a);
    await seed(a, 300, () => a.knownMarks.add({ ...GOOD, markedAt: 2 }));
    const base = serve(store);
    vi.stubGlobal("fetch", (input: string, init: RequestInit) => {
      if (init.method === "POST") store.chunks = [];
      return base(input, init);
    });

    const result = await syncNow(a, ACCOUNT);

    expect(result).toEqual({ ok: false, error: { kind: "turned-off-elsewhere" } });
    expect(store.chunks).toEqual([]);
    expect(await waitingCount(a)).toBe(1);
  });

  it("sends the oldest chunk it remembers with every push but the first upload's", async () => {
    const a = await device();
    await seed(a, 100, () =>
      a.notes.bulkAdd(["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => bigNote(id, 100_000))),
    );
    await sync(a);
    expect(store.expected[0]).toBeNull();
    expect(store.expected.length).toBeGreaterThan(1);
    expect(store.expected.slice(1).every((header) => header === "1")).toBe(true);
    await seed(a, 200, () => a.notes.put({ ...NOTE, meaning: "again" }));
    await sync(a);
    expect(store.expected.at(-1)).toBe("1");
  });

  it("another account's state stops with other-account", async () => {
    const a = await device("someone-else");
    await seed(a, 100, () => a.notes.add(NOTE));

    const result = await syncNow(a, ACCOUNT);

    expect(result).toEqual({ ok: false, error: { kind: "other-account" } });
    expect(store.calls).toEqual([]);
  });

  it("resending after a lost answer changes nothing on either device", async () => {
    const a = await device();
    await learn(a, 100);
    store.lostAnswers = 1;
    const lost = await syncNow(a, ACCOUNT);
    expect(lost).toEqual({ ok: false, error: { kind: "api", failure: { kind: "offline" } } });
    expect(store.chunks).toHaveLength(1);
    expect(await waitingCount(a)).toBeGreaterThan(0);

    await sync(a);
    const b = await device();
    await sync(b);
    const before = { a: await snapshot(a), b: await snapshot(b) };
    await sync(a);
    await sync(b);

    expect(store.chunks).toHaveLength(2);
    expect(before.a).toEqual(before.b);
    expect(await snapshot(a)).toEqual(before.a);
    expect(await snapshot(b)).toEqual(before.b);
    expect(await a.reviews.count()).toBe(1);
    expect(await b.reviews.count()).toBe(1);
  });

  it("a second tab finding the lock held does nothing", async () => {
    const a = await device();
    await seed(a, 100, () => a.notes.add(NOTE));
    const gate = Promise.withResolvers<null>();
    const holder = stubLocks()("openlinguo-sync", { ifAvailable: false }, () => gate.promise);
    await Promise.resolve();

    const result = await syncNow(a, ACCOUNT);

    expect(result).toEqual({ ok: false, error: { kind: "busy" } });
    expect(store.calls).toEqual([]);
    expect(await waitingCount(a)).toBe(1);
    gate.resolve(null);
    await holder;
  });

  it("a re-asserted note goes out in the same sync", async () => {
    const a = await device();
    const b = await device();
    const filed = (db: Database, deckId: string, time: number) =>
      seed(db, time, async () => {
        await db.decks.add({ id: deckId, name: "Package" });
        await db.notes.put(NOTE);
        await db.deckWords.put({
          note: NOTE.id,
          id: deckWordId(deckId, { note: NOTE.id }),
          deckId,
        });
        await putCards(db, [{ note: NOTE.id }]);
      });
    await filed(a, SMALL, 100);
    await sync(a);
    await filed(b, LARGE, 110);
    at(200);
    expect((await deleteDeck(a, SMALL, REFERENTIAL)).ok).toBe(true);
    await sync(a);

    await sync(b);

    expect(await b.notes.count()).toBe(1);
    expect(await waitingCount(b)).toBe(0);
    const last = (await posted()).at(-1);
    expect(last?.entities.find(({ table }) => table === "notes")).toMatchObject({
      key: NOTE.id,
      changedAt: 201,
      deleted: false,
      value: NOTE,
    });
    await sync(a);
    expect(await a.notes.toArray()).toEqual([NOTE]);
    expect(await snapshot(a)).toEqual(await snapshot(b));
  });

  it("a browser without CompressionStream gets unavailable", async () => {
    const a = await device();
    await seed(a, 100, () => a.notes.add(NOTE));
    await without("CompressionStream", async () => {
      expect(await syncNow(a, ACCOUNT)).toEqual({ ok: false, error: { kind: "unavailable" } });
    });
    expect(store.calls).toEqual([]);
  });

  it("a browser without DecompressionStream gets unavailable before any chunk is decoded", async () => {
    const a = await device();
    store.chunks.push({ id: 1, bytes: new Uint8Array([0x1f, 0x8b, 1, 2, 3]) });
    await without("DecompressionStream", async () => {
      expect(await syncNow(a, ACCOUNT)).toEqual({ ok: false, error: { kind: "unavailable" } });
    });
    expect(store.calls).toEqual([]);
  });

  it("a browser without Web Locks gets unavailable", async () => {
    const a = await device();
    vi.stubGlobal("navigator", { userAgent: "node" });
    expect(await syncNow(a, ACCOUNT)).toEqual({ ok: false, error: { kind: "unavailable" } });
    expect((await turnOn(a, ACCOUNT, 1)).ok).toBe(false);
    expect(store.calls).toEqual([]);
  });
});

describe("turnOff", () => {
  it("deletes the store, clears the rows and keeps the local data", async () => {
    const a = await device();
    await learn(a, 100);
    await sync(a);
    const before = await tables(a);

    expect(await turnOff(a)).toEqual({ ok: true, value: null });

    expect(store.chunks).toEqual([]);
    expect(await a.syncState.get("state")).toBeUndefined();
    expect(await a.syncEntities.count()).toBe(0);
    expect(await tables(a)).toEqual(before);
  });

  it("a failed deletion leaves sync on", async () => {
    const a = await device();
    await learn(a, 100);
    const rows = await a.syncEntities.count();
    store.offline = true;

    const result = await turnOff(a);

    expect(result).toEqual({ ok: false, error: { kind: "api", failure: { kind: "offline" } } });
    expect(await a.syncState.get("state")).toBeDefined();
    expect(await a.syncEntities.count()).toBe(rows);
  });
});

describe("holdsChunks", () => {
  it("answers true for an account with chunks, from a device with sync off", async () => {
    const a = await device();
    await learn(a, 100);
    await sync(a);
    const stored = store.chunks.length;

    expect(await holdsChunks()).toEqual({ ok: true, value: true });
    expect(store.chunks).toHaveLength(stored);
  });

  it("answers false for an empty store", async () => {
    expect(await holdsChunks()).toEqual({ ok: true, value: false });
  });

  it("gives the failure rather than an answer", async () => {
    store.offline = true;
    expect(await holdsChunks()).toEqual({ ok: false, error: { kind: "offline" } });
  });
});

describe("forgetSync", () => {
  it("clears what sync remembers, and the learning data stays", async () => {
    const a = await device();
    await learn(a, 100);
    const before = await tables(a);

    expect(await forgetSync(a)).toEqual({ ok: true, value: null });

    expect(await a.syncState.count()).toBe(0);
    expect(await a.syncEntities.count()).toBe(0);
    expect(await tables(a)).toEqual(before);
  });

  it("works where sync is unavailable, with nothing to clear", async () => {
    await without("CompressionStream", async () => {
      const a = fresh();
      expect(await forgetSync(a)).toEqual({ ok: true, value: null });
    });
  });

  it("says when the device cannot clear it", async () => {
    const a = await device();
    vi.spyOn(a.syncState, "delete").mockRejectedValue(new Error("disk full"));
    expect(await forgetSync(a)).toEqual({
      ok: false,
      error: { kind: "storage", message: expect.stringContaining("disk full") as string },
    });
  });
});

describe("turnOn", () => {
  it("marks everything waiting and remembers the account", async () => {
    const a = fresh();
    await seed(a, 100, () => a.notes.add(NOTE));
    await a.syncEntities.clear();

    expect(await turnOn(a, ACCOUNT, 500)).toEqual({ ok: true, value: null });

    expect(await a.syncState.get("state")).toEqual({
      id: "state",
      accountId: ACCOUNT,
      cursor: 0,
      oldest: null,
      lastSyncAt: null,
    });
    expect(await waitingCount(a)).toBe(1);
  });
});

describe("the app start", () => {
  it("clears waiting rows when sync is off", async () => {
    const a = fresh();
    await seed(a, 100, () => a.notes.add(NOTE));
    expect(await a.syncEntities.count()).toBe(1);

    expect(await clearWhenOff(a)).toEqual({ ok: true, value: null });

    expect(await a.syncEntities.count()).toBe(0);
    expect(await a.notes.count()).toBe(1);
  });

  it("keeps them when sync is on", async () => {
    const a = await device();
    await seed(a, 100, () => a.notes.add(NOTE));

    expect((await clearWhenOff(a)).ok).toBe(true);

    expect(await a.syncEntities.count()).toBe(1);
  });
});
