import {
  learningDay,
  ok,
  tally,
  type DayActivity,
  type ProgressError,
  type Result,
} from "@openlinguo/core";
import { readStored, writeStored } from "@/lib/stored";
import type { Database } from "./database.ts";
import type { LocalTime } from "./decks.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

/** A value chosen among presets, stored as text. */
export type PresetSetting<Value extends number | boolean> = {
  readonly key: string;
  readonly values: readonly Value[];
  readonly fallback: Value;
};

/** Words done per learning day (ADR 0013). */
export const DAILY_GOAL = {
  key: "openlinguo.dailyGoal",
  values: [10, 20, 50, 100],
  fallback: 20,
} as const;

/** The fallback is Anki's default `new_per_day` (ankitects/anki rslib/src/deckconfig/mod.rs). */
export const NEW_CARDS_PER_DAY = {
  key: "openlinguo.newCardsPerDay",
  values: [0, 5, 10, 20, 30],
  fallback: 20,
} as const;

/** The stored preset, the fallback when absent or unknown; fails when storage is unavailable. */
export const loadSetting = <Value extends number | boolean>(
  storage: () => Pick<Storage, "getItem">,
  setting: PresetSetting<Value>,
): Result<Value, string> => {
  const stored = readStored(storage, setting.key);
  if (!stored.ok) return stored;
  return ok(setting.values.find((value) => String(value) === stored.value) ?? setting.fallback);
};

export const saveSetting = <Value extends number | boolean>(
  storage: () => Pick<Storage, "setItem">,
  setting: PresetSetting<Value>,
  value: Value,
): Result<null, string> => writeStored(storage, setting.key, String(value));

/** The value in use: the fallback when storage is unavailable, which Profile reports. */
export const currentSetting = <Value extends number | boolean>(
  storage: () => Pick<Storage, "getItem">,
  setting: PresetSetting<Value>,
): Value => {
  const loaded = loadSetting(storage, setting);
  return loaded.ok ? loaded.value : setting.fallback;
};

/** The current learning day's activity, each review dated with its own offset as the streak counts it. */
export const todayActivity = (
  db: Database,
  now: LocalTime,
): Promise<Result<DayActivity, ReviewLogFailure | ProgressError>> =>
  guarded(async (): Promise<Result<DayActivity, ProgressError>> => {
    const today = learningDay(now.at, now.utcOffsetMinutes);
    const tallied = tally(
      await db.reviews
        .filter((review) => learningDay(review.reviewedAt, review.utcOffsetMinutes) === today)
        .toArray(),
    );
    if (!tallied.ok) return tallied;
    return ok(tallied.value.days.get(today) ?? { reviews: 0, words: 0, goalMet: false });
  });
