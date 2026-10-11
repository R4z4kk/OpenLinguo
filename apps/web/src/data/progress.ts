import {
  progress,
  stats,
  type Progress,
  type ProgressError,
  type Result,
  type Stats,
  type StatsError,
} from "@openlinguo/core";
import type { Database } from "./database.ts";
import type { LocalTime } from "./decks.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

export type ProgressFailure = ProgressError | ReviewLogFailure;
export type StatsFailure = StatsError | ReviewLogFailure;

/** XP, level, streak and achievements from the whole review log. */
export const loadProgress = (
  db: Database,
  now: LocalTime,
): Promise<Result<Progress, ProgressFailure>> =>
  guarded(async () => progress(await db.reviews.toArray(), now.at, now.utcOffsetMinutes));

/** Retention, words, recent activity and the heatmap from the whole review log. */
export const loadStats = (db: Database, now: LocalTime): Promise<Result<Stats, StatsFailure>> =>
  guarded(async () => stats(await db.reviews.toArray(), now.at, now.utcOffsetMinutes));
