import {
  progress,
  stats,
  type Progress,
  type ProgressError,
  type Result,
  type Stats,
  type StatsError,
} from "@openlinguo/core";
import type { PresetSetting } from "./daily-goal.ts";
import type { Database } from "./database.ts";
import type { LocalTime } from "./decks.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

export type ProgressFailure = ProgressError | ReviewLogFailure;
export type StatsFailure = StatsError | ReviewLogFailure;

/**
 * Whether streak, XP, level and achievements are displayed; they stay derived from the log either
 * way. Streaks and rewards for repeated actions encourage excessive use: Commission guidelines on
 * the protection of minors under DSA art. 28, OJ C/2025/5519, §57(b) and §61(b).
 */
export const SHOW_PROGRESS: PresetSetting<boolean> = {
  key: "openlinguo.showProgress",
  values: [true, false],
  fallback: true,
};

/** XP, level, streak and achievements from the whole review log. */
export const loadProgress = (
  db: Database,
  now: LocalTime,
): Promise<Result<Progress, ProgressFailure>> =>
  guarded(async () => progress(await db.reviews.toArray(), now.at, now.utcOffsetMinutes));

/** Retention, words, recent activity and the heatmap from the whole review log. */
export const loadStats = (db: Database, now: LocalTime): Promise<Result<Stats, StatsFailure>> =>
  guarded(async () => stats(await db.reviews.toArray(), now.at, now.utcOffsetMinutes));
