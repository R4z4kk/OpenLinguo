import { progress, type Progress, type ProgressError, type Result } from "@openlinguo/core";
import type { Database } from "./database.ts";
import type { LocalTime } from "./decks.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

export type ProgressFailure = ProgressError | ReviewLogFailure;

/** XP, level, streak and achievements from the whole review log. */
export const loadProgress = (
  db: Database,
  now: LocalTime,
): Promise<Result<Progress, ProgressFailure>> =>
  guarded(async () => progress(await db.reviews.toArray(), now.at, now.utcOffsetMinutes));
