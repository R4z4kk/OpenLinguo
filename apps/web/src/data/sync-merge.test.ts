import "fake-indexeddb/auto";
import {
  cardId,
  cardKey,
  CURRENT_SCHEDULER,
  NEW_CARD_STATE,
  replay,
  type Card,
  type CardKey,
  type Review,
  type WordKey,
} from "@openlinguo/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deckWordId, MY_WORDS, openDatabase, type Database, type StoredNote } from "./database.ts";
import { deleteDeck, fileWord, introduceWord } from "./decks.ts";
import { recordReview } from "./review-log.ts";
import { decodeChunk, encodeChunk, SYNC_FORMAT, SYNC_VERSION, SyncChunk } from "./sync-chunk.ts";
import { SYNCED_TABLES, type SyncEntity } from "./sync-entities.ts";
import { applyChunk } from "./sync-merge.ts";
import { seedLearning } from "./test-support.ts";

const REFERENTIAL = "hsk-2025";
const SMALL = "00000000-0000-4000-8000-00000000000a";
const LARGE = "00000000-0000-4000-8000-00000000000c";
const GOOD: WordKey = { headword: "好", readingKey: "hao3" };
const CAT: WordKey = { headword: "猫", readingKey: "mao1" };
const DOG: WordKey = { headword: "狗", readingKey: "gou3" };

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

let counter = 0;
const opened: Database[] = [];

const device = async (): Promise<Database> => {
  counter += 1;
  const db = openDatabase(`sync-merge-test-${String(counter)}`);
  opened.push(db);
  await db.syncState.put({
    id: "state",
    accountId: "account",
    cursor: 0,
    oldest: null,
    lastSyncAt: null,
  });
  return db;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const db of opened.splice(0)) db.close();
});

const at = (time: number): void => {
  vi.spyOn(Date, "now").mockReturnValue(time);
};

const seed = (db: Database, time: number, run: () => Promise<unknown>): Promise<unknown> => {
  at(time);
  return seedLearning(db, run);
};

/** A waiting row's value, as sending reads it: a deck word and a card follow from their key. */
const valueOf = async (db: Database, row: SyncEntity): Promise<unknown> => {
  switch (row.table) {
    case "cards":
      return cardKey(row.key) === null ? null : { ...cardKey(row.key), id: row.key };
    case "deckWords": {
      const [deckId = "", first = "", ...rest] = row.key.split("\t");
      return first === ""
        ? { deckId, note: rest.join("\t") }
        : { deckId, headword: first, readingKey: rest.join("\t") };
    }
    case "decks":
      return (await db.decks.get(row.key)) ?? null;
    case "notes":
      return (await db.notes.get(row.key)) ?? null;
    case "knownMarks":
      return (await db.knownMarks.get(JSON.parse(row.key) as [string, string])) ?? null;
    case "reviews":
      return null;
  }
};

/** What a device would post now, marked as sent: the waiting rows with their current values. */
const send = async (db: Database): Promise<SyncChunk> => {
  const waiting = await db.syncEntities.where("pending").equals(1).toArray();
  const reviewRows = waiting.filter((row) => row.table === "reviews");
  const others = waiting.filter((row) => row.table !== "reviews");
  const reviews = await db.reviews.bulkGet(reviewRows.map((row) => row.key));
  const entities = await Promise.all(
    others.map(async (row) => ({
      table: row.table,
      key: row.key,
      changedAt: row.changedAt,
      deleted: row.deleted,
      value: row.deleted ? null : await valueOf(db, row),
    })),
  );
  await db.syncEntities.bulkDelete(reviewRows.map((row) => row.id));
  await db.syncEntities.bulkUpdate(others.map((row) => ({ key: row.id, changes: { pending: 0 } })));
  return SyncChunk.parse({ format: SYNC_FORMAT, version: SYNC_VERSION, reviews, entities });
};

/** One chunk of a device's waiting rows, through the bytes the store keeps. */
const deliver = async (db: Database, chunks: readonly SyncChunk[], first = 1): Promise<void> => {
  for (const [index, chunk] of chunks.entries()) {
    const decoded = await decodeChunk(await encodeChunk(chunk));
    if (!decoded.ok) throw new Error(`undecodable: ${decoded.error.kind}`);
    const applied = await applyChunk(db, decoded.value, first + index);
    if (!applied.ok) throw new Error(`not applied: ${JSON.stringify(applied.error)}`);
  }
};

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

const noteEdit = (changes: Partial<StoredNote>, db: Database) => () =>
  db.notes.put({ ...NOTE, ...changes });

describe("applyChunk", () => {
  it("moves the cursor to the chunk's id", async () => {
    const db = await device();
    await deliver(
      db,
      [{ format: SYNC_FORMAT, version: SYNC_VERSION, reviews: [], entities: [] }],
      7,
    );
    expect((await db.syncState.get("state"))?.cursor).toBe(7);
  });

  it("two devices converge whatever the order", async () => {
    const a = await device();
    const b = await device();
    await seed(a, 100, async () => {
      await a.decks.add({ id: SMALL, name: "Trips" });
      await a.notes.add(NOTE);
      await a.knownMarks.add({ ...CAT, markedAt: 1 });
    });
    at(150);
    expect((await fileWord(a, SMALL, GOOD, true, REFERENTIAL)).ok).toBe(true);
    const shared = await send(a);
    await deliver(b, [shared]);

    at(200);
    expect((await fileWord(a, SMALL, CAT, true, REFERENTIAL)).ok).toBe(true);
    await seed(a, 210, noteEdit({ meaning: "from a" }, a));
    await seed(b, 300, noteEdit({ meaning: "from b" }, b));
    at(310);
    expect((await fileWord(b, MY_WORDS, DOG, true, REFERENTIAL)).ok).toBe(true);
    await seed(b, 320, () => b.knownMarks.delete(["猫", "mao1"]));
    expect((await recordReview(b, reviewOf(recall(DOG), Date.UTC(2026, 10, 3)))).ok).toBe(true);
    const chunkA = await send(a);
    const chunkB = await send(b);

    const ab = await device();
    const ba = await device();
    await deliver(ab, [shared, chunkA, chunkB]);
    await deliver(ba, [shared, chunkB, chunkA]);
    await deliver(a, [chunkB]);
    await deliver(b, [chunkA]);

    expect(await tables(ba)).toEqual(await tables(ab));
    expect(await tables(a)).toEqual(await tables(ab));
    expect(await tables(b)).toEqual(await tables(ab));
    expect((await ab.notes.get(NOTE.id))?.meaning).toBe("from b");
    expect(await ab.knownMarks.count()).toBe(0);
  });

  it("the same chunk twice changes nothing", async () => {
    const a = await device();
    await seed(a, 100, async () => {
      await a.decks.add({ id: SMALL, name: "Trips" });
      await a.notes.add(NOTE);
    });
    at(150);
    expect((await fileWord(a, SMALL, GOOD, true, REFERENTIAL)).ok).toBe(true);
    expect((await recordReview(a, reviewOf(recall(GOOD), Date.UTC(2026, 10, 3)))).ok).toBe(true);
    const chunk = await send(a);

    const b = await device();
    await deliver(b, [chunk]);
    const once = await snapshot(b);
    await deliver(b, [chunk]);
    expect(await snapshot(b)).toEqual(once);
    await deliver(a, [chunk]);
    expect(await tables(a)).toEqual(await tables(b));
  });

  it("reading back one's own chunk changes nothing", async () => {
    const a = await device();
    await seed(a, 100, () => a.notes.add(NOTE));
    const chunk = await send(a);
    const before = await snapshot(a);
    await deliver(a, [chunk]);
    expect(await snapshot(a)).toEqual(before);
  });

  describe("deciding a change", () => {
    const noteRow = (changedAt: number, changes: Partial<StoredNote> = {}) => ({
      table: "notes" as const,
      key: NOTE.id,
      changedAt,
      deleted: false,
      value: { ...NOTE, ...changes },
    });
    const gone = (changedAt: number) => ({
      table: "notes" as const,
      key: NOTE.id,
      changedAt,
      deleted: true,
      value: null,
    });
    const chunkOf = (...entities: SyncChunk["entities"]): SyncChunk => ({
      format: SYNC_FORMAT,
      version: SYNC_VERSION,
      reviews: [],
      entities,
    });

    it("a later deletion wins, an earlier one loses", async () => {
      const db = await device();
      await deliver(db, [chunkOf(noteRow(100))]);
      await deliver(db, [chunkOf(gone(50))]);
      expect(await db.notes.count()).toBe(1);
      await deliver(db, [chunkOf(gone(150))]);
      expect(await db.notes.count()).toBe(0);
      expect(await db.syncEntities.get(`notes:${NOTE.id}`)).toEqual({
        id: `notes:${NOTE.id}`,
        table: "notes",
        key: NOTE.id,
        changedAt: 150,
        deleted: true,
        pending: 0,
      });
      await deliver(db, [chunkOf(noteRow(120))]);
      expect(await db.notes.count()).toBe(0);
      await deliver(db, [chunkOf(noteRow(160))]);
      expect(await db.notes.count()).toBe(1);
    });

    it("on a tie the deletion wins, then the larger serialized value", async () => {
      const small = noteRow(100, { meaning: "a" });
      const large = noteRow(100, { meaning: "b" });
      for (const order of [
        [small, large, gone(100)],
        [gone(100), large, small],
        [large, gone(100), small],
      ]) {
        const db = await device();
        await deliver(db, [chunkOf(...order)]);
        expect(await db.notes.count()).toBe(0);
      }
      for (const order of [
        [small, large],
        [large, small],
      ]) {
        const db = await device();
        for (const row of order) await deliver(db, [chunkOf(row)]);
        expect((await db.notes.get(NOTE.id))?.meaning).toBe("b");
      }
    });

    it("a tie is decided the same whatever the key order of the stored value", async () => {
      // As card-proposal.ts writes it: content first.
      const shuffled = (db: Database, meaning: string) =>
        seed(db, 100, () =>
          db.notes.put({
            updatedAt: NOTE.updatedAt,
            provenance: null,
            meaning,
            pinyin: NOTE.pinyin,
            characters: NOTE.characters,
            id: NOTE.id,
          }),
        );
      const a = await device();
      const b = await device();
      await shuffled(a, "a");
      await shuffled(b, "b");
      const chunkA = await send(a);
      const chunkB = await send(b);
      await deliver(a, [chunkB]);
      await deliver(b, [chunkA]);
      expect((await a.notes.get(NOTE.id))?.meaning).toBe("b");
      expect((await b.notes.get(NOTE.id))?.meaning).toBe("b");
    });

    it("a change that loses keeps the local one waiting; one that wins replaces it", async () => {
      const db = await device();
      await seed(db, 100, () => db.notes.put(NOTE));
      await deliver(db, [chunkOf(noteRow(50, { meaning: "older" }))]);
      expect(await db.syncEntities.get(`notes:${NOTE.id}`)).toMatchObject({
        changedAt: 100,
        pending: 1,
      });
      await deliver(db, [chunkOf(noteRow(150, { meaning: "newer" }))]);
      expect(await db.syncEntities.get(`notes:${NOTE.id}`)).toMatchObject({
        changedAt: 150,
        pending: 0,
      });
      expect((await db.notes.get(NOTE.id))?.meaning).toBe("newer");
    });

    it("merges known marks", async () => {
      const db = await device();
      const key = JSON.stringify(["好", "hao3"]);
      await deliver(db, [
        chunkOf({
          table: "knownMarks",
          key,
          changedAt: 100,
          deleted: false,
          value: { ...GOOD, markedAt: 9 },
        }),
      ]);
      expect(await db.knownMarks.toArray()).toEqual([{ ...GOOD, markedAt: 9 }]);
      await deliver(db, [
        chunkOf({ table: "knownMarks", key, changedAt: 101, deleted: true, value: null }),
      ]);
      expect(await db.knownMarks.count()).toBe(0);
    });
  });

  describe("clock differences", () => {
    it("a device whose clock is behind edits a row it received, and both keep the edit", async () => {
      const a = await device();
      const b = await device();
      await seed(b, 1000, () => b.notes.put(NOTE));
      await deliver(a, [await send(b)]);
      await seed(a, 500, () => a.notes.put({ ...NOTE, meaning: "edited after receiving" }));
      await deliver(b, [await send(a)]);
      expect((await a.notes.get(NOTE.id))?.meaning).toBe("edited after receiving");
      expect((await b.notes.get(NOTE.id))?.meaning).toBe("edited after receiving");
      expect(await snapshot(a)).toEqual(await snapshot(b));
    });

    it("a device whose clock is behind deletes a row it received, and both lose it", async () => {
      const a = await device();
      const b = await device();
      await seed(b, 1000, () => b.notes.put(NOTE));
      await deliver(a, [await send(b)]);
      await seed(a, 500, () => a.notes.delete(NOTE.id));
      await deliver(b, [await send(a)]);
      expect(await a.notes.count()).toBe(0);
      expect(await b.notes.count()).toBe(0);
      expect(await snapshot(a)).toEqual(await snapshot(b));
    });
  });

  describe("referentials", () => {
    const CAT_ENTRY = {
      id: "猫\tmao1",
      simplified: "猫",
      reading: "mao1",
      variants: [],
      glosses: [[], [], []] as const,
      hsk2025: 1,
      gf0025: null,
      lexicon: true,
      frequency: null,
    };

    it.each(["hsk-2025", "gf0025-2021"] as const)(
      "devices on different referentials converge when a word leaves its deck on %s",
      async (referential) => {
        const a = await device();
        const b = await device();
        await a.entries.add(CAT_ENTRY);
        await b.entries.add(CAT_ENTRY);
        at(100);
        expect((await fileWord(a, MY_WORDS, CAT, true, referential)).ok).toBe(true);
        await deliver(b, [await send(a)]);
        at(200);
        expect((await fileWord(a, MY_WORDS, CAT, false, referential)).ok).toBe(true);
        await deliver(b, [await send(a)]);

        expect(await b.deckWords.count()).toBe(0);
        expect(await b.cards.count()).toBe(referential === "hsk-2025" ? 2 : 0);
        expect(await tables(a)).toEqual(await tables(b));
      },
    );
  });

  describe("words and decks", () => {
    const start = async (word: WordKey = GOOD) => {
      const a = await device();
      const b = await device();
      await seed(a, 100, () => a.decks.add({ id: SMALL, name: "Trips" }));
      at(110);
      expect((await fileWord(a, SMALL, word, true, REFERENTIAL)).ok).toBe(true);
      await deliver(b, [await send(a)]);
      return { a, b };
    };

    it("a word whose deck was deleted goes with it, and a card filed since stays", async () => {
      const { a, b } = await start();
      at(200);
      expect((await deleteDeck(b, SMALL, REFERENTIAL)).ok).toBe(true);
      at(300);
      expect((await fileWord(a, SMALL, CAT, true, REFERENTIAL)).ok).toBe(true);
      await a.audio.add({
        id: deckWordId(SMALL, CAT),
        type: "audio/mpeg",
        data: new ArrayBuffer(1),
      });

      const chunkA = await send(a);
      const chunkB = await send(b);
      await deliver(a, [chunkB]);
      await deliver(b, [chunkA]);

      for (const db of [a, b]) {
        expect(await db.decks.count()).toBe(0);
        expect(await db.deckWords.count()).toBe(0);
        expect(await db.cards.get(recall(GOOD).id)).toBeUndefined();
        expect(await db.cards.get(recall(CAT).id)).toBeDefined();
      }
      expect(await a.audio.count()).toBe(0);
      expect(await tables(a)).toEqual(await tables(b));
    });

    it("a card arriving after its word went with its deck stays too", async () => {
      const { a, b } = await start();
      at(200);
      expect((await deleteDeck(b, SMALL, REFERENTIAL)).ok).toBe(true);
      at(300);
      expect((await fileWord(a, SMALL, CAT, true, REFERENTIAL)).ok).toBe(true);
      const chunkA = await send(a);
      const words = { ...chunkA, entities: chunkA.entities.filter((e) => e.table === "deckWords") };
      const cards = { ...chunkA, entities: chunkA.entities.filter((e) => e.table === "cards") };
      await deliver(b, [words, cards]);
      await deliver(a, [await send(b)]);
      expect(await b.cards.get(recall(CAT).id)).toBeDefined();
      expect(await tables(a)).toEqual(await tables(b));
    });

    it("a word with another filing keeps its cards when its deck goes", async () => {
      const { a, b } = await start();
      at(120);
      expect((await fileWord(a, MY_WORDS, GOOD, true, REFERENTIAL)).ok).toBe(true);
      await deliver(b, [await send(a)]);
      at(200);
      expect((await deleteDeck(b, SMALL, REFERENTIAL)).ok).toBe(true);
      await deliver(a, [await send(b)]);
      expect((await a.deckWords.toArray()).map(({ id }) => id)).toEqual([
        deckWordId(MY_WORDS, GOOD),
      ]);
      expect(await a.cards.get(recall(GOOD).id)).toBeDefined();
      expect(await tables(a)).toEqual(await tables(b));
    });

    it("a word filed before its deck arrives stays, and goes if the deck was deleted", async () => {
      const a = await device();
      const b = await device();
      await seed(a, 100, () => a.decks.add({ id: SMALL, name: "Trips" }));
      at(110);
      expect((await fileWord(a, SMALL, GOOD, true, REFERENTIAL)).ok).toBe(true);
      const chunk = await send(a);
      const words = { ...chunk, entities: chunk.entities.filter((e) => e.table !== "decks") };
      const decks = { ...chunk, entities: chunk.entities.filter((e) => e.table === "decks") };
      await deliver(b, [words]);
      expect(await b.deckWords.count()).toBe(1);
      await deliver(b, [decks]);
      expect(await b.deckWords.count()).toBe(1);
      expect(await tables(b)).toEqual(await tables(a));
    });

    it("a deck renamed after its deletion comes back with the words filed since", async () => {
      const { a, b } = await start();
      at(200);
      expect((await deleteDeck(a, SMALL, REFERENTIAL)).ok).toBe(true);
      at(300);
      expect((await fileWord(b, SMALL, CAT, true, REFERENTIAL)).ok).toBe(true);
      const words = await send(b);
      await seed(b, 400, () => b.decks.put({ id: SMALL, name: "Renamed" }));
      const rename = await send(b);
      const deletion = await send(a);
      await deliver(a, [words, rename]);
      await deliver(b, [deletion]);

      expect((await a.decks.toArray()).map(({ name }) => name)).toEqual(["Renamed"]);
      expect((await a.deckWords.toArray()).map(({ id }) => id)).toEqual([deckWordId(SMALL, CAT)]);
      expect(await tables(a)).toEqual(await tables(b));
    });

    it("a word filed again while its deletion travels gets its progress back when introduced", async () => {
      const { a, b } = await start();
      expect((await recordReview(a, reviewOf(recall(GOOD), Date.UTC(2026, 10, 3)))).ok).toBe(true);
      await deliver(b, [await send(a)]);
      at(200);
      expect((await fileWord(a, SMALL, GOOD, false, REFERENTIAL)).ok).toBe(true);
      at(300);
      expect((await fileWord(b, MY_WORDS, GOOD, true, REFERENTIAL)).ok).toBe(true);
      const chunkA = await send(a);
      const chunkB = await send(b);
      await deliver(a, [chunkB]);
      await deliver(b, [chunkA]);
      expect(await a.cards.count()).toBe(0);
      expect(await tables(a)).toEqual(await tables(b));

      expect((await introduceWord(b, GOOD)).ok).toBe(true);
      expect((await b.cards.get(recall(GOOD).id))?.reps).toBe(1);
    });
  });

  describe("reviews and cards", () => {
    const makeCard = (card: Card, changedAt: number) => ({
      table: "cards" as const,
      key: card.id,
      changedAt,
      deleted: false,
      value: card,
    });

    it("a review of an unknown card is kept, and the card's state appears when the card arrives", async () => {
      const card = recall(GOOD);
      const review = reviewOf(card, Date.UTC(2026, 10, 3));
      const db = await device();
      await deliver(db, [
        { format: SYNC_FORMAT, version: SYNC_VERSION, reviews: [review], entities: [] },
      ]);
      expect(await db.reviews.toArray()).toEqual([review]);
      expect(await db.cards.count()).toBe(0);

      await deliver(db, [
        {
          format: SYNC_FORMAT,
          version: SYNC_VERSION,
          reviews: [],
          entities: [makeCard(card, 100)],
        },
      ]);
      const stored = await db.cards.get(card.id);
      const state = replay(card.id, [review]);
      expect(state.ok && stored).toEqual(state.ok && { ...card, ...state.value });
      expect(stored?.reps).toBe(1);
    });

    it("card states match a replay of the merged log", async () => {
      const card = recall(GOOD);
      const a = await device();
      const b = await device();
      at(100);
      expect((await fileWord(a, MY_WORDS, GOOD, true, REFERENTIAL)).ok).toBe(true);
      await deliver(b, [await send(a)]);
      const first = reviewOf(card, Date.UTC(2026, 10, 3));
      const second = reviewOf(card, Date.UTC(2026, 10, 5));
      expect((await recordReview(a, second)).ok).toBe(true);
      expect((await recordReview(b, first)).ok).toBe(true);
      const chunkA = await send(a);
      const chunkB = await send(b);
      await deliver(a, [chunkB]);
      await deliver(b, [chunkA]);

      const state = replay(card.id, [first, second]);
      if (!state.ok) throw new Error(state.error.kind);
      expect(await a.cards.get(card.id)).toEqual({ ...card, ...state.value });
      expect(await b.cards.get(card.id)).toEqual({ ...card, ...state.value });
    });

    it("a card arriving again keeps its state", async () => {
      const card = recall(GOOD);
      const review = reviewOf(card, Date.UTC(2026, 10, 3));
      const db = await device();
      const chunk = (changedAt: number): SyncChunk => ({
        format: SYNC_FORMAT,
        version: SYNC_VERSION,
        reviews: [review],
        entities: [makeCard(card, changedAt)],
      });
      await deliver(db, [chunk(100)]);
      await deliver(db, [chunk(200)]);
      expect((await db.cards.get(card.id))?.reps).toBe(1);
    });

    it("a new card has a new card's state", async () => {
      const card = recall(GOOD);
      const db = await device();
      await deliver(db, [
        {
          format: SYNC_FORMAT,
          version: SYNC_VERSION,
          reviews: [],
          entities: [makeCard(card, 100)],
        },
      ]);
      expect(await db.cards.get(card.id)).toEqual({ ...card, ...NEW_CARD_STATE });
    });

    it("a later deletion of a card keeps its reviews", async () => {
      const card = recall(GOOD);
      const db = await device();
      const review = reviewOf(card, Date.UTC(2026, 10, 3));
      await deliver(db, [
        {
          format: SYNC_FORMAT,
          version: SYNC_VERSION,
          reviews: [review],
          entities: [makeCard(card, 100)],
        },
        {
          format: SYNC_FORMAT,
          version: SYNC_VERSION,
          reviews: [],
          entities: [{ table: "cards", key: card.id, changedAt: 200, deleted: true, value: null }],
        },
      ]);
      expect(await db.cards.count()).toBe(0);
      expect(await db.reviews.count()).toBe(1);
    });
  });

  describe("decks of the same name", () => {
    const SMALL_DECK = { id: SMALL, name: "Voyage" };
    const LARGE_DECK = { id: LARGE, name: "voyage" };
    const decksOf = async (db: Database) => (await db.decks.toArray()).sort(byId);
    const wordsOf = async (db: Database) =>
      (await db.deckWords.toArray()).map(({ id }) => id).sort();

    it.each([true, false])(
      "same-name decks stay separate and both devices hold both, with their words (smaller first: %s)",
      async (smallFirst) => {
        const small = await device();
        const large = await device();
        await seed(small, 100, () => small.decks.add(SMALL_DECK));
        await seed(large, 90, () => large.decks.add(LARGE_DECK));
        at(110);
        expect((await fileWord(small, SMALL, GOOD, true, REFERENTIAL)).ok).toBe(true);
        expect((await fileWord(large, LARGE, CAT, true, REFERENTIAL)).ok).toBe(true);
        const chunkSmall = await send(small);
        const chunkLarge = await send(large);

        const third = await device();
        await deliver(third, smallFirst ? [chunkSmall, chunkLarge] : [chunkLarge, chunkSmall]);
        await deliver(small, [chunkLarge]);
        await deliver(large, [chunkSmall]);

        for (const db of [small, large, third]) {
          expect(await decksOf(db)).toEqual([SMALL_DECK, LARGE_DECK]);
          expect(await wordsOf(db)).toEqual(
            [deckWordId(SMALL, GOOD), deckWordId(LARGE, CAT)].sort(),
          );
        }
        expect(await tables(small)).toEqual(await tables(third));
        expect(await tables(large)).toEqual(await tables(third));
      },
    );

    it("a deck renamed before its device hears of the other deck of that name stays apart", async () => {
      const a = await device();
      const b = await device();
      await seed(b, 100, () => b.decks.add({ id: LARGE, name: "Voyage" }));
      at(101);
      expect((await fileWord(b, LARGE, CAT, true, REFERENTIAL)).ok).toBe(true);
      const first = await send(b);
      await seed(a, 110, () => a.decks.add(SMALL_DECK));
      at(111);
      expect((await fileWord(a, SMALL, GOOD, true, REFERENTIAL)).ok).toBe(true);
      const second = await send(a);
      await seed(b, 200, () => b.decks.put({ id: LARGE, name: "Other" }));
      const third = await send(b);

      for (const db of [a, b]) {
        await deliver(db, [first, second, third]);
        expect(await decksOf(db)).toEqual([SMALL_DECK, { id: LARGE, name: "Other" }]);
        expect(await wordsOf(db)).toEqual([deckWordId(SMALL, GOOD), deckWordId(LARGE, CAT)].sort());
      }
      expect(await tables(a)).toEqual(await tables(b));
    });

    it("a deck deleted before its device hears of the other deck of that name takes nothing with it", async () => {
      const a = await device();
      const b = await device();
      await seed(a, 100, () => a.decks.add(SMALL_DECK));
      const first = await send(a);
      await seed(b, 110, () => b.decks.add({ id: LARGE, name: "Voyage" }));
      at(111);
      expect((await fileWord(b, LARGE, CAT, true, REFERENTIAL)).ok).toBe(true);
      const second = await send(b);
      at(200);
      expect((await deleteDeck(a, SMALL, REFERENTIAL)).ok).toBe(true);
      const third = await send(a);

      for (const db of [a, b]) {
        await deliver(db, [first, second, third]);
        expect(await decksOf(db)).toEqual([{ id: LARGE, name: "Voyage" }]);
        expect(await wordsOf(db)).toEqual([deckWordId(LARGE, CAT)]);
        expect(await db.cards.get(recall(CAT).id)).toBeDefined();
      }
      expect(await tables(a)).toEqual(await tables(b));
    });
  });

  describe("recording and failures", () => {
    it("applying records nothing to send", async () => {
      const a = await device();
      await seed(a, 100, async () => {
        await a.decks.add({ id: SMALL, name: "Trips" });
        await a.notes.add(NOTE);
        await a.knownMarks.add({ ...CAT, markedAt: 1 });
      });
      at(110);
      expect((await fileWord(a, SMALL, GOOD, true, REFERENTIAL)).ok).toBe(true);
      expect((await recordReview(a, reviewOf(recall(GOOD), Date.UTC(2026, 10, 3)))).ok).toBe(true);
      const chunk = await send(a);

      const b = await device();
      await deliver(b, [chunk]);
      expect(await b.syncEntities.where("pending").equals(1).count()).toBe(0);
      expect((await b.syncEntities.toArray()).some(({ table }) => table === "reviews")).toBe(false);
    });

    const failing = async () => {
      const a = await device();
      await seed(a, 100, () => a.decks.add({ id: SMALL, name: "Trips" }));
      at(110);
      expect((await fileWord(a, SMALL, GOOD, true, REFERENTIAL)).ok).toBe(true);
      expect((await recordReview(a, reviewOf(recall(GOOD), Date.UTC(2026, 10, 3)))).ok).toBe(true);
      const chunk = await send(a);
      const b = await device();
      await seed(b, 50, () => b.notes.add(NOTE));
      return { b, chunk };
    };

    it("a failure leaves the tables and the cursor untouched", async () => {
      const { b, chunk } = await failing();
      const before = await snapshot(b);
      vi.spyOn(b.syncState, "update").mockRejectedValue(new Error("disk full"));
      const applied = await applyChunk(b, chunk, 3);
      expect(applied).toEqual({
        ok: false,
        error: { kind: "storage", message: expect.stringContaining("disk full") as string },
      });
      vi.restoreAllMocks();
      expect(await snapshot(b)).toEqual(before);
      expect((await b.syncState.get("state"))?.cursor).toBe(0);
    });

    it("a replay failure is reported as it is, and rolls back", async () => {
      const { b, chunk } = await failing();
      const [review] = chunk.reviews;
      if (review == null) throw new Error("no review");
      const retired: unknown = { ...review, scheduler: "retired" };
      await seedLearning(b, () =>
        b.table<unknown, string>("reviews").add({
          ...(retired as Review),
          id: "00000000-0000-4000-8000-0000000000ff",
          reviewedAt: review.reviewedAt - 1,
        }),
      );
      const before = await snapshot(b);
      const applied = await applyChunk(b, chunk, 3);
      expect(applied.ok).toBe(false);
      if (applied.ok) return;
      expect(applied.error.kind).toBe("scheduler-failure");
      expect(await snapshot(b)).toEqual(before);
      expect((await b.syncState.get("state"))?.cursor).toBe(0);
    });

    it("with sync off it fails and creates nothing", async () => {
      const { b, chunk } = await failing();
      await b.syncState.clear();
      const applied = await applyChunk(b, chunk, 3);
      expect(applied).toEqual({
        ok: false,
        error: { kind: "storage", message: "Sync is off on this device" },
      });
      expect(await b.syncState.count()).toBe(0);
      expect(await b.decks.count()).toBe(0);
    });
  });
});
