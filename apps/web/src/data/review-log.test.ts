import "fake-indexeddb/auto";
import {
  cardId,
  CURRENT_SCHEDULER,
  err,
  NEW_CARD_STATE,
  ok,
  replay,
  type CardKey,
  type CardState,
  type CardType,
  type Grade,
  type Review,
} from "@openlinguo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database, type StoredCard } from "./database.ts";
import { rebuildCards, recordReview } from "./review-log.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const card = (type: CardType): StoredCard => {
  const key: CardKey = { language: "zh", headword: "好", readingKey: "hao3", type };
  return { ...key, id: cardId(key), ...NEW_CARD_STATE, personal: true };
};
const RECOGNITION = card("recognition");
const RECALL = card("recall");

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

const start = Date.UTC(2026, 9, 21, 6);

let db: Database;
let counter = 0;

beforeEach(async () => {
  counter += 1;
  db = openDatabase(`review-log-test-${String(counter)}`);
  await db.cards.bulkAdd([RECOGNITION, RECALL]);
});

describe("recordReview", () => {
  it("stores the review with its card state, found by due date", async () => {
    const first = review(1, RECOGNITION.id, start, "good");
    const state = replayed(RECOGNITION.id, [first]);
    expect(await recordReview(db, first)).toEqual(ok(state));
    expect(await db.reviews.toArray()).toEqual([first]);
    expect(await db.cards.get(RECOGNITION.id)).toEqual({ ...RECOGNITION, ...state });
    expect(
      await db.cards
        .where("due")
        .belowOrEqual(start + DAY)
        .primaryKeys(),
    ).toEqual([RECOGNITION.id]);
  });

  it("replays a late review in order", async () => {
    const early = review(1, RECOGNITION.id, start, "again");
    const late = review(2, RECOGNITION.id, start + 2 * DAY, "good");
    await recordReview(db, late);
    expect(await recordReview(db, early)).toEqual(ok(replayed(RECOGNITION.id, [early, late])));
  });

  it("refuses a review of an unknown card and writes nothing", async () => {
    expect(await recordReview(db, review(1, "missing", start, "good"))).toEqual(
      err({ kind: "unknown-card", cardId: "missing" }),
    );
    expect(await db.reviews.count()).toBe(0);
  });

  it("refuses the same review twice", async () => {
    const first = review(1, RECOGNITION.id, start, "good");
    await recordReview(db, first);
    expect(await recordReview(db, first)).toEqual(
      err({ kind: "duplicate-review", reviewId: first.id }),
    );
    expect(await db.reviews.count()).toBe(1);
  });

  it("rolls the review back when its card state cannot be written", async () => {
    vi.spyOn(db.cards, "put").mockRejectedValueOnce(new Error("QuotaExceededError"));
    expect(await recordReview(db, review(1, RECOGNITION.id, start, "good"))).toEqual(
      err({ kind: "storage", message: "Error: QuotaExceededError" }),
    );
    expect(await db.reviews.count()).toBe(0);
    expect(await db.cards.get(RECOGNITION.id)).toEqual(RECOGNITION);
  });
});

describe("rebuildCards", () => {
  it("replays every card from an imported log and keeps reviews of removed cards", async () => {
    const first = review(1, RECOGNITION.id, start, "good");
    const recall = review(2, RECALL.id, start + DAY, "hard");
    const lapse = review(3, RECOGNITION.id, start + 2 * DAY, "again");
    const removed = review(4, "removed", start, "easy");
    await db.reviews.bulkAdd([lapse, recall, removed, first]);
    expect(await rebuildCards(db)).toEqual(ok(null));
    expect(await db.cards.get(RECOGNITION.id)).toEqual({
      ...RECOGNITION,
      ...replayed(RECOGNITION.id, [first, lapse]),
    });
    expect(await db.cards.get(RECALL.id)).toEqual({ ...RECALL, ...replayed(RECALL.id, [recall]) });
    expect(await db.cards.count()).toBe(2);
    expect(await db.reviews.count()).toBe(4);
  });

  it("surfaces a log it cannot replay and leaves the cache as it was", async () => {
    await db.reviews.add(review(1, RECALL.id, start, "good"));
    await db
      .table("reviews")
      .add({ ...review(2, RECOGNITION.id, start, "good"), scheduler: "fsrs7-v1" });
    expect(await rebuildCards(db)).toMatchObject({
      ok: false,
      error: { kind: "scheduler-failure" },
    });
    expect(await db.cards.get(RECALL.id)).toEqual(RECALL);
  });
});
