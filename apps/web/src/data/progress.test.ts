import "fake-indexeddb/auto";
import { cardId, CURRENT_SCHEDULER, err, type Review } from "@openlinguo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "./database.ts";
import { loadProgress, loadStats } from "./progress.ts";

const PARIS = 120;
// 2026-10-21 12:00 in Paris.
const NOON = Date.UTC(2026, 9, 21, 10);

const review = (n: number, card: string): Review => ({
  id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
  cardId: card,
  grade: "good",
  reviewedAt: NOON + n * 60_000,
  utcOffsetMinutes: PARIS,
  scheduler: CURRENT_SCHEDULER,
  dailyGoal: 2,
  wordDone: null,
});

const RECOGNITION = cardId({
  language: "zh",
  headword: "好",
  readingKey: "hao3",
  type: "recognition",
});

let db: Database;
let name = 0;

beforeEach(() => {
  name += 1;
  db = openDatabase(`progress-test-${String(name)}`);
});

describe("loadProgress", () => {
  it("computes the progress of the whole stored log", async () => {
    await db.reviews.bulkAdd([review(1, RECOGNITION), review(2, RECOGNITION)]);
    const result = await loadProgress(db, { at: NOON + 3_600_000, utcOffsetMinutes: PARIS });
    expect(result).toMatchObject({
      ok: true,
      value: { xp: 20, level: 1, streak: 1, achievements: ["reviews-1"] },
    });
  });

  it("starts from nothing on an empty log", async () => {
    const result = await loadProgress(db, { at: NOON, utcOffsetMinutes: PARIS });
    expect(result).toMatchObject({ ok: true, value: { xp: 0, level: 1, streak: 0 } });
  });

  it("passes a log error on", async () => {
    const broken = review(1, "not a card id");
    await db.reviews.add(broken);
    expect(await loadProgress(db, { at: NOON, utcOffsetMinutes: PARIS })).toEqual(
      err({ kind: "invalid-card-id", reviewId: broken.id }),
    );
  });

  it("reports a storage failure", async () => {
    vi.spyOn(db.reviews, "toArray").mockRejectedValueOnce(new Error("UnknownError"));
    expect(await loadProgress(db, { at: NOON, utcOffsetMinutes: PARIS })).toEqual(
      err({ kind: "storage", message: "Error: UnknownError" }),
    );
  });
});

describe("loadStats", () => {
  it("computes the stats of the whole stored log", async () => {
    await db.reviews.bulkAdd([review(1, RECOGNITION), review(2, RECOGNITION)]);
    const result = await loadStats(db, { at: NOON + 3_600_000, utcOffsetMinutes: PARIS });
    if (!result.ok) throw new Error(result.error.kind);
    expect(result.value).toMatchObject({
      retention: { passed: 0, total: 0 },
      words: 1,
      recent: { reviews: 2, studiedDays: 1 },
    });
    expect(result.value.weeks.at(-1)?.days[2]).toEqual({
      day: "2026-10-21",
      reviews: 2,
      words: 2,
      goalMet: true,
    });
  });

  it("passes a log error on", async () => {
    const broken = review(1, "not a card id");
    await db.reviews.add(broken);
    expect(await loadStats(db, { at: NOON, utcOffsetMinutes: PARIS })).toEqual(
      err({ kind: "invalid-card-id", reviewId: broken.id }),
    );
  });

  it("reports a storage failure", async () => {
    vi.spyOn(db.reviews, "toArray").mockRejectedValueOnce(new Error("UnknownError"));
    expect(await loadStats(db, { at: NOON, utcOffsetMinutes: PARIS })).toEqual(
      err({ kind: "storage", message: "Error: UnknownError" }),
    );
  });
});
