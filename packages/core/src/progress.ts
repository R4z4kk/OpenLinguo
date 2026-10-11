import { err, ok, type Result } from "./result.ts";
import { cardKey, chronological, learningDay, type Review } from "./srs.ts";

const DAY = 24 * 60 * 60_000;

/** The same for every grade, so self-grading stays honest. */
export const XP_PER_REVIEW = 10;

/** One freeze is earned per this many streak days. */
const FREEZE_EVERY = 7;
const MAX_FREEZES = 2;

/** The XP a level starts at: 100·(level − 1)², so each level takes longer than the last. */
export const levelStart = (level: number): number => 100 * (level - 1) ** 2;

export const levelOf = (xp: number): number => {
  let level = 1;
  while (levelStart(level + 1) <= xp) level += 1;
  return level;
};

export type Metric = "reviews" | "words" | "longestStreak" | "goalDays";

export type Achievement = {
  readonly id: string;
  readonly metric: Metric;
  readonly threshold: number;
};

const milestones = (metric: Metric, thresholds: readonly number[]): readonly Achievement[] =>
  thresholds.map((threshold) => ({ id: `${metric}-${String(threshold)}`, metric, threshold }));

/** Permanent milestones: totals never decrease, so an achievement is never lost. */
export const ACHIEVEMENTS: readonly Achievement[] = [
  ...milestones("reviews", [1, 100, 1_000, 10_000]),
  ...milestones("words", [10, 100, 500, 1_000]),
  ...milestones("longestStreak", [7, 30, 100, 365]),
  ...milestones("goalDays", [10, 50, 100, 365]),
];

export type Progress = {
  readonly xp: number;
  readonly level: number;
  readonly streak: number;
  readonly freezes: number;
  /** `words`: readings with a review; `goalDays`: learning days whose goal was met. */
  readonly totals: Readonly<Record<Metric, number>>;
  readonly achievements: readonly string[];
};

export type ProgressError =
  | { readonly kind: "duplicate-review"; readonly reviewId: string }
  | { readonly kind: "invalid-card-id"; readonly reviewId: string };

const nextDay = (day: string): string => new Date(Date.parse(day) + DAY).toISOString().slice(0, 10);

/** Missed days before the last one use a freeze or end the streak; the last may be in progress. */
const streakOf = (metDays: ReadonlySet<string>, today: string) => {
  let current = 0;
  let longest = 0;
  let freezes = 0;
  const days = [...metDays].sort();
  const first = days[0];
  const lastMet = days.at(-1);
  if (first == null || lastMet == null) return { current, longest, freezes };
  const end = lastMet > today ? lastMet : today;
  for (let day = first; day <= end; day = nextDay(day)) {
    if (metDays.has(day)) {
      current += 1;
      longest = Math.max(longest, current);
      if (current % FREEZE_EVERY === 0) freezes = Math.min(MAX_FREEZES, freezes + 1);
    } else if (day < end) {
      if (freezes > 0) freezes -= 1;
      else current = 0;
    }
  }
  return { current, longest, freezes };
};

/**
 * XP, level, streak and achievements from the review log alone, in any order. `at` only tells
 * which learning day is still in progress. A day is met once its review count reaches the goal
 * stamped on the review just made, so lowering the goal counts at the next review and raising it
 * never unmeets a day.
 */
export const progress = (
  reviews: readonly Review[],
  at: number,
  utcOffsetMinutes: number,
): Result<Progress, ProgressError> => {
  const ids = new Set<string>();
  const words = new Set<string>();
  const counts = new Map<string, number>();
  const metDays = new Set<string>();
  for (const review of [...reviews].sort(chronological)) {
    if (ids.has(review.id)) return err({ kind: "duplicate-review", reviewId: review.id });
    ids.add(review.id);
    const key = cardKey(review.cardId);
    if (key === null) return err({ kind: "invalid-card-id", reviewId: review.id });
    words.add(JSON.stringify([key.language, key.headword, key.readingKey]));
    const day = learningDay(review.reviewedAt, review.utcOffsetMinutes);
    const count = (counts.get(day) ?? 0) + 1;
    counts.set(day, count);
    if (count >= review.dailyGoal) metDays.add(day);
  }
  const streak = streakOf(metDays, learningDay(at, utcOffsetMinutes));
  const totals = {
    reviews: ids.size,
    words: words.size,
    longestStreak: streak.longest,
    goalDays: metDays.size,
  };
  const xp = totals.reviews * XP_PER_REVIEW;
  return ok({
    xp,
    level: levelOf(xp),
    streak: streak.current,
    freezes: streak.freezes,
    totals,
    achievements: ACHIEVEMENTS.filter(({ metric, threshold }) => totals[metric] >= threshold).map(
      ({ id }) => id,
    ),
  });
};
