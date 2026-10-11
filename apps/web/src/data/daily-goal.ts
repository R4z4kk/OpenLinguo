import { learningDay, ok, type Result } from "@openlinguo/core";
import { readStored, writeStored } from "@/lib/stored";
import type { Database } from "./database.ts";
import type { LocalTime } from "./decks.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

/** A number chosen among presets, stored as text. */
export type NumberSetting<Value extends number> = {
  readonly key: string;
  readonly values: readonly Value[];
  readonly fallback: Value;
};

/** Reviews per learning day. */
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
export const loadSetting = <Value extends number>(
  storage: () => Pick<Storage, "getItem">,
  setting: NumberSetting<Value>,
): Result<Value, string> => {
  const stored = readStored(storage, setting.key);
  if (!stored.ok) return stored;
  return ok(setting.values.find((value) => String(value) === stored.value) ?? setting.fallback);
};

export const saveSetting = <Value extends number>(
  storage: () => Pick<Storage, "setItem">,
  setting: NumberSetting<Value>,
  value: Value,
): Result<null, string> => writeStored(storage, setting.key, String(value));

/** The value in use: the fallback when storage is unavailable, which Profile reports. */
export const currentSetting = <Value extends number>(
  storage: () => Pick<Storage, "getItem">,
  setting: NumberSetting<Value>,
): Value => {
  const loaded = loadSetting(storage, setting);
  return loaded.ok ? loaded.value : setting.fallback;
};

/** Reviews of the current learning day, each dated with its own offset as the streak counts it. */
export const reviewsToday = (
  db: Database,
  now: LocalTime,
): Promise<Result<number, ReviewLogFailure>> =>
  guarded(async () => {
    const today = learningDay(now.at, now.utcOffsetMinutes);
    return ok(
      await db.reviews
        .filter((review) => learningDay(review.reviewedAt, review.utcOffsetMinutes) === today)
        .count(),
    );
  });
