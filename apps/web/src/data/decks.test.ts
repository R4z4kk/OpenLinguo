import "fake-indexeddb/auto";
import {
  cardId,
  CURRENT_SCHEDULER,
  NEW_CARD_STATE,
  ok,
  replay,
  type CardType,
  type Phase,
  type Review,
} from "@openlinguo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database, type StoredCard, type StoredEntry } from "./database.ts";
import {
  addWord,
  deckCounts,
  isPersonal,
  nextNewReadings,
  removeWord,
  type LocalTime,
  type WordKey,
} from "./decks.ts";
import { recordReview } from "./review-log.ts";

const entry = (
  simplified: string,
  readingKey: string,
  hsk2025: number | null,
  gf0025: number | null,
  frequency: number | null,
): StoredEntry => ({
  id: `${simplified}\t${readingKey}`,
  simplified,
  reading: readingKey,
  variants: [],
  glosses: [[], [], []],
  hsk2025,
  gf0025,
  lexicon: true,
  frequency,
});

const HAO: WordKey = { headword: "好", readingKey: "hao3" };
const NI: WordKey = { headword: "你", readingKey: "ni3" };
const XING: WordKey = { headword: "行", readingKey: "xing2" };
const HANG: WordKey = { headword: "行", readingKey: "hang2" };
const E: WordKey = { headword: "鹅", readingKey: "e2" };
const TIAN: WordKey = { headword: "天", readingKey: "tian1" };

const ENTRIES = [
  entry("好", "hao3", 1, 1, 7),
  entry("你", "ni3", 1, 1, 7.5),
  entry("行", "xing2", 1, 2, 6),
  entry("行", "hang2", 3, null, 6),
  entry("鹅", "e2", null, 3, 4),
  entry("天", "tian1", 2, 1, 7),
];

const HOUR = 3_600_000;
// Paris summer: local noon on 2026-10-21.
const NOW: LocalTime = { at: Date.UTC(2026, 9, 21, 10), utcOffsetMinutes: 120 };
const NEXT_ROLLOVER = Date.UTC(2026, 9, 22, 2);

const idOf = (word: WordKey, type: CardType): string => cardId({ language: "zh", ...word, type });

const stored = (
  word: WordKey,
  type: CardType,
  phase: Phase,
  due: number | null,
  personal: boolean,
): StoredCard => ({
  language: "zh",
  ...word,
  type,
  id: idOf(word, type),
  ...NEW_CARD_STATE,
  phase,
  due,
  personal,
});

const review = (cardId: string, grade: Review["grade"]): Review => ({
  id: "00000000-0000-4000-8000-000000000001",
  cardId,
  grade,
  reviewedAt: NOW.at,
  utcOffsetMinutes: NOW.utcOffsetMinutes,
  scheduler: CURRENT_SCHEDULER,
});

let db: Database;
let counter = 0;

beforeEach(async () => {
  counter += 1;
  db = openDatabase(`decks-test-${String(counter)}`);
  await db.entries.bulkAdd(ENTRIES);
});

describe("my words", () => {
  it("adds both cards of a reading", async () => {
    expect(await addWord(db, HAO)).toEqual(ok(null));
    expect(await db.cards.toArray()).toEqual(
      expect.arrayContaining([
        stored(HAO, "recognition", "new", null, true),
        stored(HAO, "recall", "new", null, true),
      ]),
    );
    expect(await db.cards.count()).toBe(2);
    expect(await isPersonal(db, HAO)).toEqual(ok(true));
    expect(await isPersonal(db, NI)).toEqual(ok(false));
  });

  it("removes the cards, keeps their reviews and restores the progress when added again", async () => {
    await addWord(db, HAO);
    const first = review(idOf(HAO, "recognition"), "good");
    await recordReview(db, first);
    expect(await removeWord(db, HAO)).toEqual(ok(null));
    expect(await db.cards.count()).toBe(0);
    expect(await db.reviews.toArray()).toEqual([first]);
    expect(await isPersonal(db, HAO)).toEqual(ok(false));

    await addWord(db, HAO);
    const state = replay(first.cardId, [first]);
    if (!state.ok) throw new Error(state.error.kind);
    expect(await db.cards.get(first.cardId)).toMatchObject({ ...state.value, personal: true });
  });

  it("marks a band card as personal without changing its progress", async () => {
    await db.cards.add(stored(NI, "recognition", "review", NOW.at, false));
    await db.cards.add(stored(NI, "recall", "new", null, false));
    await addWord(db, NI);
    expect(await isPersonal(db, NI)).toEqual(ok(true));
  });

  it("writes nothing when the log cannot be replayed or the cards cannot be stored", async () => {
    await db
      .table("reviews")
      .add({ ...review(idOf(HAO, "recall"), "good"), scheduler: "fsrs7-v1" });
    expect(await addWord(db, HAO)).toMatchObject({
      ok: false,
      error: { kind: "scheduler-failure" },
    });
    vi.spyOn(db.cards, "bulkPut").mockRejectedValueOnce(new Error("QuotaExceededError"));
    expect(await addWord(db, NI)).toEqual({
      ok: false,
      error: { kind: "storage", message: "Error: QuotaExceededError" },
    });
    expect(await db.cards.count()).toBe(0);
  });
});

describe("deckCounts", () => {
  it("counts each graded reading of a band as new cards", async () => {
    const empty = { new: 0, learning: 0, due: 0 };
    expect(await deckCounts(db, "hsk-2025", NOW)).toEqual(
      ok({
        personal: empty,
        bands: [
          { ...empty, new: 6 },
          { ...empty, new: 2 },
          { ...empty, new: 2 },
          empty,
          empty,
          empty,
          empty,
        ],
      }),
    );
  });

  it("counts started cards due before the next 4:00 rollover", async () => {
    await db.cards.bulkAdd([
      stored(HAO, "recognition", "review", NEXT_ROLLOVER - 1, true),
      stored(HAO, "recall", "new", null, true),
      stored(E, "recognition", "learning", NOW.at + HOUR / 6, true),
      stored(E, "recall", "review", NEXT_ROLLOVER, true),
      stored(NI, "recognition", "relearning", NOW.at - HOUR, false),
      stored(NI, "recall", "new", null, false),
    ]);
    const counts = await deckCounts(db, "gf0025-2021", NOW);
    expect(counts).toMatchObject({
      ok: true,
      value: {
        personal: { new: 1, learning: 1, due: 1 },
        bands: [
          { new: 4, learning: 1, due: 1 },
          { new: 2, learning: 0, due: 0 },
          { new: 0, learning: 1, due: 0 },
          ...Array.from({ length: 4 }, () => ({ new: 0, learning: 0, due: 0 })),
        ],
      },
    });
  });
});

describe("nextNewReadings", () => {
  beforeEach(async () => {
    await addWord(db, E);
    await addWord(db, HANG);
    await db.cards.bulkAdd([
      stored(TIAN, "recognition", "review", NOW.at, true),
      stored(TIAN, "recall", "new", null, true),
    ]);
  });

  it("puts my words first, then the bands by level and frequency", async () => {
    expect(await nextNewReadings(db, "hsk-2025", 10)).toEqual(ok([HANG, E, NI, HAO, XING]));
  });

  it("stops at the limit", async () => {
    expect(await nextNewReadings(db, "hsk-2025", 3)).toEqual(ok([HANG, E, NI]));
  });

  it("orders by the chosen referential", async () => {
    expect(await nextNewReadings(db, "gf0025-2021", 10)).toEqual(ok([E, HANG, NI, HAO, XING]));
  });
});
