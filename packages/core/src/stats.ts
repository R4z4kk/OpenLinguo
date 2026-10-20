import type { SchedulerFailure } from "./fsrs.ts";
import { addDays, tally, type DayActivity, type ProgressError } from "./progress.ts";
import { ok, type Result } from "./result.ts";
import {
  applyReview,
  chronological,
  learningDay,
  NEW_CARD_STATE,
  type CardState,
  type Review,
} from "./srs.ts";

/** The recent window of retention and activity, Anki's "month". */
export const RECENT_DAYS = 30;
export const HEATMAP_WEEKS = 12;

export type StatsError = ProgressError | SchedulerFailure;

export type HeatmapDay = DayActivity & { readonly day: string };

/** Monday to Sunday; days after today are `null`. */
export type HeatmapWeek = { readonly start: string; readonly days: readonly (HeatmapDay | null)[] };

export type Ratio = { readonly passed: number; readonly total: number };

export type Stats = {
  /**
   * Anki's true retention over the recent days (rslib/src/stats/graphs/retention.rs): reviews of
   * cards past their learning steps, `again` fails.
   */
  readonly retention: Ratio;
  /** Readings with a review, as the words achievements count them. */
  readonly words: number;
  readonly recent: { readonly reviews: number; readonly studiedDays: number };
  /** Oldest first, the last one holding today. */
  readonly weeks: readonly HeatmapWeek[];
};

const retentionOf = (
  reviews: readonly Review[],
  from: string,
  to: string,
): Result<Ratio, SchedulerFailure> => {
  const states = new Map<string, CardState>();
  let passed = 0;
  let total = 0;
  for (const review of [...reviews].sort(chronological)) {
    const state = states.get(review.cardId) ?? NEW_CARD_STATE;
    const day = learningDay(review.reviewedAt, review.utcOffsetMinutes);
    if (state.phase === "review" && day >= from && day <= to) {
      total += 1;
      if (review.grade !== "again") passed += 1;
    }
    const next = applyReview(state, review);
    if (!next.ok) return next;
    states.set(review.cardId, next.value);
  }
  return ok({ passed, total });
};

const mondayIndex = (day: string): number => (new Date(Date.parse(day)).getUTCDay() + 6) % 7;

/** Learning stats from the review log alone, in any order. `at` tells which day is today. */
export const stats = (
  reviews: readonly Review[],
  at: number,
  utcOffsetMinutes: number,
): Result<Stats, StatsError> => {
  const tallied = tally(reviews);
  if (!tallied.ok) return tallied;
  const { days, words } = tallied.value;
  const today = learningDay(at, utcOffsetMinutes);
  const from = addDays(today, 1 - RECENT_DAYS);
  const retention = retentionOf(reviews, from, today);
  if (!retention.ok) return retention;
  const recent = { reviews: 0, studiedDays: 0 };
  for (const [day, activity] of days) {
    if (day < from || day > today) continue;
    recent.reviews += activity.reviews;
    recent.studiedDays += 1;
  }
  const first = addDays(today, -mondayIndex(today) - 7 * (HEATMAP_WEEKS - 1));
  const weeks = Array.from({ length: HEATMAP_WEEKS }, (_, week) => {
    const start = addDays(first, 7 * week);
    return {
      start,
      days: Array.from({ length: 7 }, (_, weekday) => {
        const day = addDays(start, weekday);
        return day > today
          ? null
          : { day, ...(days.get(day) ?? { reviews: 0, words: 0, goalMet: false }) };
      }),
    };
  });
  return ok({ retention: retention.value, words, recent, weeks });
};
