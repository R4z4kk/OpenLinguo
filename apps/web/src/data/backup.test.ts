import "fake-indexeddb/auto";
import {
  cardId,
  CURRENT_SCHEDULER,
  NEW_CARD_STATE,
  ok,
  replay,
  type Card,
  type CardKey,
  type CardState,
  type CardType,
  type Grade,
  type Review,
} from "@openlinguo/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  exportBackup,
  importBackup,
  parseBackup,
  type Backup,
  type Settings,
} from "./backup.ts";
import { deckWordId, MY_WORDS, openDatabase, type Database } from "./database.ts";

const DAY = 24 * 60 * 60_000;
const start = Date.UTC(2026, 9, 21, 6);
const now = new Date(start + 3 * DAY);

const card = (headword: string, readingKey: string, type: CardType): Card => {
  const key: CardKey = { language: "zh", headword, readingKey, type };
  return { ...key, id: cardId(key) };
};
const RECOGNITION = card("好", "hao3", "recognition");
const RECALL = card("好", "hao3", "recall");
const CAT = card("猫", "mao1", "recognition");

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const review = (n: number, cardId: string, reviewedAt: number, grade: Grade): Review => ({
  id: uuid(n),
  cardId,
  grade,
  reviewedAt,
  utcOffsetMinutes: 120,
  scheduler: CURRENT_SCHEDULER,
});

const replayed = (id: string, log: readonly Review[]): CardState => {
  const state = replay(id, log);
  if (!state.ok) throw new Error(state.error.kind);
  return state.value;
};

const SETTINGS: Settings = {
  language: "fr",
  theme: "dark",
  referential: "gf0025-2021",
  dailyGoal: 50,
  newCardsPerDay: 0,
};
const ANIMALS = { id: uuid(100), name: "Animals" };

const backup = (data: Partial<Backup>): Backup => ({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  exportedAt: now.toISOString(),
  settings: SETTINGS,
  cards: [],
  reviews: [],
  decks: [],
  deckWords: [],
  ...data,
});

let db: Database;
let counter = 0;

beforeEach(() => {
  counter += 1;
  db = openDatabase(`backup-test-${String(counter)}`);
});

describe("exportBackup", () => {
  it("exports cards without their state, the log, decks and settings, and parses back", async () => {
    const first = review(1, RECOGNITION.id, start, "good");
    await db.cards.bulkAdd([
      { ...RECOGNITION, ...replayed(RECOGNITION.id, [first]) },
      { ...RECALL, ...NEW_CARD_STATE },
    ]);
    await db.reviews.add(first);
    await db.decks.add(ANIMALS);
    await db.deckWords.add({
      id: deckWordId(ANIMALS.id, RECOGNITION),
      deckId: ANIMALS.id,
      headword: "好",
      readingKey: "hao3",
    });

    const exported = await exportBackup(db, SETTINGS, now);
    const expected = backup({
      cards: [RECOGNITION, RECALL].toSorted((a, b) => (a.id < b.id ? -1 : 1)),
      reviews: [first],
      decks: [ANIMALS],
      deckWords: [{ deckId: ANIMALS.id, headword: "好", readingKey: "hao3" }],
    });
    expect(exported).toEqual(ok(expected));
    expect(parseBackup(JSON.stringify(expected))).toEqual(ok(expected));
  });
});

describe("parseBackup", () => {
  it("names a file that is not JSON, not a backup or from a newer version", () => {
    expect(parseBackup("{")).toMatchObject({ ok: false, error: { kind: "not-json" } });
    expect(parseBackup("[]")).toEqual({ ok: false, error: { kind: "not-backup" } });
    expect(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 2 }))).toEqual({
      ok: false,
      error: { kind: "newer-version", version: 2 },
    });
  });

  it("gives settings missing from an older backup their fallback", () => {
    const older = { language: "fr", theme: "dark", referential: "gf0025-2021" };
    expect(parseBackup(JSON.stringify({ ...backup({}), settings: older }))).toEqual(
      ok(backup({ settings: { ...SETTINGS, dailyGoal: 20, newCardsPerDay: 20 } })),
    );
  });

  it("lists each failing path", () => {
    const valid = backup({ decks: [ANIMALS] });
    const parsed = parseBackup(
      JSON.stringify({
        ...valid,
        reviews: [{ ...review(1, RECALL.id, start, "good"), grade: "perfect" }],
        cards: [{ ...RECALL, type: "recognition" }],
      }),
    );
    expect(parsed).toMatchObject({
      ok: false,
      error: { kind: "invalid", issues: [{ path: "cards.0.id" }, { path: "reviews.0.grade" }] },
    });
  });

  it("refuses duplicate ids, deck names taken and words filed in a missing deck", () => {
    const first = review(1, RECALL.id, start, "good");
    const parsed = parseBackup(
      JSON.stringify(
        backup({
          reviews: [first, first],
          decks: [ANIMALS, { id: uuid(101), name: " animals " }],
          deckWords: [{ deckId: uuid(102), headword: "猫", readingKey: "mao1" }],
        }),
      ),
    );
    expect(parsed).toMatchObject({
      ok: false,
      error: {
        kind: "invalid",
        issues: [
          { path: "reviews.1.id" },
          { path: "decks.1.name" },
          { path: "deckWords.0.deckId" },
        ],
      },
    });
  });
});

describe("importBackup", () => {
  it("replays every card from the merged log and keeps reviews of removed cards", async () => {
    const local = review(1, RECOGNITION.id, start, "good");
    await db.cards.add({ ...RECOGNITION, ...replayed(RECOGNITION.id, [local]) });
    await db.reviews.add(local);
    const lapse = review(2, RECOGNITION.id, start + 2 * DAY, "again");
    const recall = review(3, RECALL.id, start + DAY, "hard");
    const removed = review(4, "removed", start, "easy");

    expect(
      await importBackup(db, backup({ cards: [RECALL], reviews: [local, lapse, recall, removed] })),
    ).toEqual(ok({ reviews: 3, cards: 1, decks: 0, words: 0 }));
    expect(await db.cards.get(RECOGNITION.id)).toEqual({
      ...RECOGNITION,
      ...replayed(RECOGNITION.id, [local, lapse]),
    });
    expect(await db.cards.get(RECALL.id)).toEqual({ ...RECALL, ...replayed(RECALL.id, [recall]) });
    expect(await db.cards.count()).toBe(2);
    expect(await db.reviews.count()).toBe(4);
  });

  it("files words in my words and new decks, and changes nothing the second time", async () => {
    const data = backup({
      cards: [CAT],
      decks: [ANIMALS],
      deckWords: [
        { deckId: MY_WORDS, headword: "猫", readingKey: "mao1" },
        { deckId: ANIMALS.id, headword: "猫", readingKey: "mao1" },
      ],
    });
    expect(await importBackup(db, data)).toEqual(ok({ reviews: 0, cards: 1, decks: 1, words: 2 }));
    expect(await importBackup(db, data)).toEqual(ok({ reviews: 0, cards: 0, decks: 0, words: 0 }));
    expect(await db.decks.toArray()).toEqual([ANIMALS]);
    expect((await db.deckWords.toArray()).map((word) => word.id).toSorted()).toEqual(
      [deckWordId(ANIMALS.id, CAT), deckWordId(MY_WORDS, CAT)].toSorted(),
    );
  });

  it("keeps local deck names and merges an imported deck into the local one of the same name", async () => {
    await db.decks.bulkAdd([
      { id: ANIMALS.id, name: "Zoo" },
      { id: uuid(101), name: "Food" },
    ]);
    const data = backup({
      decks: [ANIMALS, { id: uuid(102), name: "food" }],
      deckWords: [
        { deckId: ANIMALS.id, headword: "猫", readingKey: "mao1" },
        { deckId: uuid(102), headword: "好", readingKey: "hao3" },
      ],
    });
    expect(await importBackup(db, data)).toEqual(ok({ reviews: 0, cards: 0, decks: 0, words: 2 }));
    expect(await db.decks.toArray()).toEqual([
      { id: ANIMALS.id, name: "Zoo" },
      { id: uuid(101), name: "Food" },
    ]);
    expect(await db.deckWords.get(deckWordId(uuid(101), RECOGNITION))).toMatchObject({
      deckId: uuid(101),
    });
  });

  it("writes nothing when the merged log cannot be replayed", async () => {
    await db.cards.add({ ...RECALL, ...NEW_CARD_STATE });
    await db
      .table("reviews")
      .add({ ...review(1, RECALL.id, start, "good"), scheduler: "fsrs7-v1" });
    const data = backup({
      cards: [CAT],
      reviews: [review(2, CAT.id, start, "good")],
      decks: [ANIMALS],
    });
    expect(await importBackup(db, data)).toMatchObject({
      ok: false,
      error: { kind: "scheduler-failure" },
    });
    expect(await db.cards.toArray()).toEqual([{ ...RECALL, ...NEW_CARD_STATE }]);
    expect(await db.reviews.count()).toBe(1);
    expect(await db.decks.count()).toBe(0);
  });
});
