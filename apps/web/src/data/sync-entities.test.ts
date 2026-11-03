import "fake-indexeddb/auto";
import {
  cardId,
  CURRENT_SCHEDULER,
  NEW_CARD_STATE,
  type CardKey,
  type Review,
} from "@openlinguo/core";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deckWordId,
  openDatabase,
  type Database,
  type StoredCard,
  type StoredNote,
} from "./database.ts";
import { recordReview } from "./review-log.ts";
import { seedLearning } from "./test-support.ts";
import {
  clearEntities,
  markAllWaiting,
  silently,
  SYNCED_TABLES,
  type SyncedTable,
} from "./sync-entities.ts";

const CARD_KEY: CardKey = { language: "zh", headword: "好", readingKey: "hao3", type: "recall" };
const CARD: StoredCard = { ...CARD_KEY, id: cardId(CARD_KEY), ...NEW_CARD_STATE };
const REVIEW: Review = {
  id: "00000000-0000-4000-8000-000000000001",
  cardId: CARD.id,
  grade: "good",
  reviewedAt: Date.UTC(2026, 10, 3, 6),
  utcOffsetMinutes: 60,
  scheduler: CURRENT_SCHEDULER,
  dailyGoal: 20,
  wordDone: null,
};
const DECK = { id: "deck-1", name: "Travel" };
const DECK_WORD = {
  id: deckWordId(DECK.id, CARD),
  deckId: DECK.id,
  headword: "好",
  readingKey: "hao3",
};
const NOTE: StoredNote = {
  id: "note-1",
  characters: "你好",
  pinyin: "nǐ hǎo",
  meaning: "hello",
  updatedAt: 42,
  provenance: null,
};
const MARK = { headword: "好", readingKey: "hao3", markedAt: 7 };

const NOW = 1_000;

let db: Database;
let counter = 0;

const scoped = <T>(run: () => Promise<T>): Promise<T> => seedLearning(db, run);

const WRITES: Record<SyncedTable, { add: () => Promise<unknown>; key: string }> = {
  reviews: { add: () => db.reviews.add(REVIEW), key: REVIEW.id },
  cards: { add: () => db.cards.add(CARD), key: CARD.id },
  decks: { add: () => db.decks.add(DECK), key: DECK.id },
  deckWords: { add: () => db.deckWords.add(DECK_WORD), key: DECK_WORD.id },
  notes: { add: () => db.notes.add(NOTE), key: NOTE.id },
  knownMarks: { add: () => db.knownMarks.add(MARK), key: JSON.stringify(["好", "hao3"]) },
};

const rows = () => db.syncEntities.orderBy("id").toArray();

beforeEach(() => {
  counter += 1;
  db = openDatabase(`sync-entities-test-${String(counter)}`);
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

describe("recordChanges", () => {
  it.each(SYNCED_TABLES)("records a write to %s with its time", async (table) => {
    await scoped(WRITES[table].add);
    expect(await rows()).toEqual([
      {
        id: `${table}:${WRITES[table].key}`,
        table,
        key: WRITES[table].key,
        changedAt: NOW,
        deleted: false,
        pending: 1,
      },
    ]);
  });

  it.each(SYNCED_TABLES.filter((table) => table !== "reviews"))(
    "records a deletion from %s as deleted: true",
    async (table) => {
      await scoped(WRITES[table].add);
      await db.syncEntities.update(`${table}:${WRITES[table].key}`, { pending: 0 });
      vi.spyOn(Date, "now").mockReturnValue(NOW + 5);
      await scoped(() => db.table(table).clear());
      expect(await rows()).toEqual([
        {
          id: `${table}:${WRITES[table].key}`,
          table,
          key: WRITES[table].key,
          changedAt: NOW + 5,
          deleted: true,
          pending: 1,
        },
      ]);
    },
  );

  it("a local write passes the time the device has seen, whatever its clock", async () => {
    await scoped(WRITES.notes.add);
    await db.syncEntities.update(`notes:${NOTE.id}`, { changedAt: NOW + 500, pending: 0 });
    await scoped(() => db.notes.put({ ...NOTE, meaning: "hi" }));
    expect(await db.syncEntities.get(`notes:${NOTE.id}`)).toMatchObject({
      changedAt: NOW + 501,
      pending: 1,
    });
    await scoped(() => db.notes.delete(NOTE.id));
    expect(await db.syncEntities.get(`notes:${NOTE.id}`)).toMatchObject({
      changedAt: NOW + 502,
      deleted: true,
    });
  });

  it("refuses the write when its record cannot be stored", async () => {
    vi.spyOn(db.Table.prototype, "put").mockImplementation(() =>
      Dexie.Promise.reject(new Error("disk full")),
    );
    await expect(scoped(WRITES.notes.add)).rejects.toThrow(/abort/i);
    vi.restoreAllMocks();
    expect(await db.notes.count()).toBe(0);
    expect(await db.syncEntities.count()).toBe(0);
  });

  it("records a review, not its card's state", async () => {
    await scoped(() => db.cards.add(CARD));
    await clearEntities(db);
    const stored = await recordReview(db, REVIEW);
    expect(stored.ok).toBe(true);
    expect((await rows()).map(({ id }) => id)).toEqual([`reviews:${REVIEW.id}`]);
  });

  it("cards record creation and deletion, not updates", async () => {
    await scoped(() => db.cards.add(CARD));
    await db.syncEntities.update(`cards:${CARD.id}`, { pending: 0 });
    await scoped(() => db.cards.put({ ...CARD, reps: 3 }));
    expect(await db.syncEntities.get(`cards:${CARD.id}`)).toMatchObject({ pending: 0 });
    await scoped(() => db.cards.delete(CARD.id));
    expect(await db.syncEntities.get(`cards:${CARD.id}`)).toMatchObject({
      deleted: true,
      pending: 1,
    });
  });

  it("notes and decks record updates", async () => {
    await scoped(async () => {
      await db.notes.add(NOTE);
      await db.decks.add(DECK);
    });
    await db.syncEntities.toCollection().modify({ pending: 0 });
    vi.spyOn(Date, "now").mockReturnValue(NOW + 9);
    await scoped(async () => {
      await db.notes.put({ ...NOTE, meaning: "hi" });
      await db.decks.put({ ...DECK, name: "Trips" });
    });
    expect(await rows()).toMatchObject([
      { id: "decks:deck-1", changedAt: NOW + 9, deleted: false, pending: 1 },
      { id: "notes:note-1", changedAt: NOW + 9, deleted: false, pending: 1 },
    ]);
  });

  it("records nothing for a deletion of a key that is not stored", async () => {
    await scoped(async () => {
      await db.knownMarks.delete(["好", "hao3"]);
      await db.notes.bulkDelete(["gone"]);
    });
    expect(await db.syncEntities.count()).toBe(0);
  });

  it("refuses a write outside a sync-aware transaction", async () => {
    await expect(db.notes.put(NOTE)).rejects.toThrow(/outside a sync-aware transaction/);
    await expect(db.transaction("rw", db.notes, () => db.notes.put(NOTE))).rejects.toThrow(
      /outside a sync-aware transaction/,
    );
    expect(await db.notes.count()).toBe(0);
    expect(await db.syncEntities.count()).toBe(0);
  });

  it("rolls back with the write", async () => {
    await expect(
      scoped(async () => {
        await db.notes.add(NOTE);
        throw new Error("fails after the write");
      }),
    ).rejects.toThrow("fails after the write");
    expect(await db.notes.count()).toBe(0);
    expect(await db.syncEntities.count()).toBe(0);
  });
});

describe("silently", () => {
  it("records nothing, then records again in the same transaction", async () => {
    await scoped(async () => {
      await silently(db, () => db.notes.add(NOTE));
      await db.decks.add(DECK);
    });
    expect(await db.notes.count()).toBe(1);
    expect((await rows()).map(({ id }) => id)).toEqual(["decks:deck-1"]);
  });

  it("writes in a transaction without syncEntities", async () => {
    await db.transaction("rw", db.notes, () => silently(db, () => db.notes.add(NOTE)));
    expect(await db.notes.count()).toBe(1);
  });

  it("refuses to run outside a transaction", async () => {
    await expect(silently(db, () => db.notes.add(NOTE))).rejects.toThrow(/outside a transaction/);
    expect(await db.notes.count()).toBe(0);
  });
});

describe("markAllWaiting", () => {
  it("marks every entity at now, a note at its updatedAt", async () => {
    await scoped(async () => {
      await Promise.all(SYNCED_TABLES.map((table) => WRITES[table].add()));
      await db.decks.add({ id: "deck-2", name: "Gone" });
    });
    await scoped(() => db.decks.delete("deck-2"));
    await db.syncEntities.toCollection().modify({ pending: 0, changedAt: 1 });

    await markAllWaiting(db, 500);

    const all = await rows();
    expect(all.map(({ id }) => id)).toEqual(
      SYNCED_TABLES.map((table) => `${table}:${WRITES[table].key}`)
        .concat("decks:deck-2")
        .sort(),
    );
    expect(all.every(({ pending }) => pending === 1)).toBe(true);
    expect(Object.fromEntries(all.map(({ id, changedAt }) => [id, changedAt]))).toEqual({
      [`reviews:${REVIEW.id}`]: 500,
      [`cards:${CARD.id}`]: 500,
      "decks:deck-1": 500,
      "decks:deck-2": 1,
      [`deckWords:${DECK_WORD.id}`]: 500,
      "notes:note-1": NOTE.updatedAt,
      [`knownMarks:${JSON.stringify(["好", "hao3"])}`]: 500,
    });
    expect(all.find(({ id }) => id === "decks:deck-2")?.deleted).toBe(true);
  });

  it("is undone by clearEntities", async () => {
    await scoped(WRITES.notes.add);
    await clearEntities(db);
    expect(await db.syncEntities.count()).toBe(0);
  });
});

describe("upgrades", () => {
  it("opens a database upgraded from version 8 with data", async () => {
    const name = "sync-upgrade-8";
    const legacy = new Dexie(name);
    legacy.version(8).stores({
      cards: "id, due",
      reviews: "id, cardId",
      decks: "id",
      deckWords: "id, deckId, [headword+readingKey]",
      audio: "id",
    });
    const old = { ...REVIEW };
    Reflect.deleteProperty(old, "wordDone");
    await legacy.table("cards").add(CARD);
    await legacy.table("reviews").add(old);
    await legacy.table("decks").add(DECK);
    legacy.close();

    const upgraded = openDatabase(name);
    expect(await upgraded.cards.toArray()).toEqual([CARD]);
    expect(await upgraded.reviews.toArray()).toEqual([{ ...old, wordDone: null }]);
    expect(await upgraded.decks.toArray()).toEqual([DECK]);
    expect(await upgraded.syncEntities.count()).toBe(0);
    await upgraded.transaction("rw", [upgraded.syncEntities, upgraded.decks], () =>
      upgraded.decks.add({ id: "deck-2", name: "New" }),
    );
    expect(await upgraded.syncEntities.count()).toBe(1);
    upgraded.close();
  });

  it("opens a database upgraded from version 14, whose notes are migrated", async () => {
    const name = "sync-upgrade-14";
    const legacy = new Dexie(name);
    legacy.version(14).stores({ notes: "id" });
    const old = { ...NOTE };
    Reflect.deleteProperty(old, "provenance");
    await legacy.table("notes").add(old);
    legacy.close();

    const upgraded = openDatabase(name);
    expect(await upgraded.notes.toArray()).toEqual([NOTE]);
    expect(await upgraded.syncEntities.count()).toBe(0);
    upgraded.close();
  });

  it("opens a database upgraded from version 24 with data", async () => {
    const name = "sync-upgrade-24";
    const legacy = new Dexie(name);
    legacy.version(24).stores({ notes: "id", knownMarks: "[headword+readingKey]" });
    await legacy.table("notes").add(NOTE);
    await legacy.table("knownMarks").add(MARK);
    legacy.close();

    const upgraded = openDatabase(name);
    expect(await upgraded.notes.toArray()).toEqual([NOTE]);
    expect(await upgraded.knownMarks.toArray()).toEqual([MARK]);
    expect(await upgraded.syncEntities.count()).toBe(0);
    expect(await upgraded.syncState.count()).toBe(0);
    upgraded.close();
  });
});
