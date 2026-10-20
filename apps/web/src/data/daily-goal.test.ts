import "fake-indexeddb/auto";
import { cardId, CURRENT_SCHEDULER, type Review } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import {
  currentSetting,
  DAILY_GOAL,
  loadSetting,
  NEW_CARDS_PER_DAY,
  saveSetting,
  todayActivity,
} from "./daily-goal.ts";
import { openDatabase } from "./database.ts";
import { SHOW_PROGRESS } from "./progress.ts";

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

const unavailable = (): never => {
  throw new Error("SecurityError");
};

const review = (n: number, reviewedAt: number, utcOffsetMinutes: number): Review => ({
  id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
  cardId: cardId({ language: "zh", headword: "你", readingKey: "ni3", type: "recognition" }),
  grade: "good",
  reviewedAt,
  utcOffsetMinutes,
  scheduler: CURRENT_SCHEDULER,
  dailyGoal: 20,
  wordDone: null,
});

describe("settings", () => {
  it("falls back to 20 reviews and 20 new cards", () => {
    const storage = memory();
    expect(loadSetting(() => storage, DAILY_GOAL)).toEqual({ ok: true, value: 20 });
    expect(loadSetting(() => storage, NEW_CARDS_PER_DAY)).toEqual({ ok: true, value: 20 });
  });

  it("reads back a saved preset, zero new cards included", () => {
    const storage = memory();
    expect(saveSetting(() => storage, DAILY_GOAL, 50)).toEqual({ ok: true, value: null });
    expect(saveSetting(() => storage, NEW_CARDS_PER_DAY, 0)).toEqual({ ok: true, value: null });
    expect(loadSetting(() => storage, DAILY_GOAL)).toEqual({ ok: true, value: 50 });
    expect(loadSetting(() => storage, NEW_CARDS_PER_DAY)).toEqual({ ok: true, value: 0 });
  });

  it("ignores a value that is not a preset", () => {
    const storage = memory();
    storage.setItem(DAILY_GOAL.key, "15");
    storage.setItem(NEW_CARDS_PER_DAY.key, "5.0");
    expect(loadSetting(() => storage, DAILY_GOAL)).toEqual({ ok: true, value: 20 });
    expect(loadSetting(() => storage, NEW_CARDS_PER_DAY)).toEqual({ ok: true, value: 20 });
  });

  it("shows progress by default and reads back a hidden choice", () => {
    const storage = memory();
    expect(loadSetting(() => storage, SHOW_PROGRESS)).toEqual({ ok: true, value: true });
    expect(saveSetting(() => storage, SHOW_PROGRESS, false)).toEqual({ ok: true, value: null });
    expect(loadSetting(() => storage, SHOW_PROGRESS)).toEqual({ ok: true, value: false });
    storage.setItem(SHOW_PROGRESS.key, "no");
    expect(loadSetting(() => storage, SHOW_PROGRESS)).toEqual({ ok: true, value: true });
  });

  it("reports an unavailable storage and uses the fallback meanwhile", () => {
    expect(loadSetting(unavailable, DAILY_GOAL).ok).toBe(false);
    expect(saveSetting(unavailable, DAILY_GOAL, 10).ok).toBe(false);
    expect(currentSetting(unavailable, DAILY_GOAL)).toBe(20);
  });
});

describe("todayActivity", () => {
  it("counts the reviews of the learning day, which starts at 4:00 at each review's offset", async () => {
    const db = openDatabase("daily-goal-test");
    const PARIS = 120;
    const NEW_YORK = -240;
    await db.reviews.bulkAdd([
      // 2026-10-21 04:00 in Paris.
      review(1, Date.UTC(2026, 9, 21, 2), PARIS),
      // 2026-10-21 03:59 in Paris: still the 20th.
      review(2, Date.UTC(2026, 9, 21, 1, 59), PARIS),
      // 2026-10-20 23:30 in New York, 05:30 the next day in Paris.
      review(3, Date.UTC(2026, 9, 21, 3, 30), NEW_YORK),
      // 2026-10-21 20:00 in New York.
      review(4, Date.UTC(2026, 9, 22), NEW_YORK),
    ]);
    // 2026-10-22 03:30 in Paris: still the 21st.
    const now = { at: Date.UTC(2026, 9, 22, 1, 30), utcOffsetMinutes: PARIS };
    expect(await todayActivity(db, now)).toEqual({
      ok: true,
      value: { reviews: 2, words: 2, goalMet: false },
    });
    expect(await todayActivity(db, { ...now, at: now.at + 30 * 60_000 })).toEqual({
      ok: true,
      value: { reviews: 0, words: 0, goalMet: false },
    });
  });
});
