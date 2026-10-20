import { describe, expect, test } from "vitest";
import { CURRENT_SCHEDULER } from "./fsrs.ts";
import { err } from "./result.ts";
import { cardId, type CardType, type Grade, type Review } from "./srs.ts";
import { HEATMAP_WEEKS, stats } from "./stats.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// Thursday 2026-10-01, noon UTC: day 40 is Tuesday 2026-11-10.
const START = Date.UTC(2026, 9, 1, 12);
const TODAY = 40;

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const card = (headword: string, type: CardType = "recognition"): string =>
  cardId({ language: "zh", headword, readingKey: "r", type });
const at = (day: number, minutes = 0): number => START + day * DAY + minutes * MINUTE;

let next = 0;
const review = (cardOf: string, grade: Grade, reviewedAt: number): Review => {
  next += 1;
  return {
    id: uuid(next),
    cardId: cardOf,
    grade,
    reviewedAt,
    utcOffsetMinutes: 0,
    scheduler: CURRENT_SCHEDULER,
    dailyGoal: 2,
    wordDone: null,
  };
};

const run = (log: readonly Review[]) => {
  const result = stats(log, at(TODAY), 0);
  if (!result.ok) throw new Error(result.error.kind);
  return result.value;
};

/** Recent days run from day 11 to day 40. */
const LOG = [
  review(card("好"), "easy", at(0)),
  review(card("好"), "again", at(20)),
  review(card("好"), "good", at(20, 10)),
  review(card("好"), "hard", at(30)),
  review(card("好", "recall"), "good", at(35)),
  review(card("人"), "easy", at(5)),
  review(card("人"), "good", at(10)),
  review(card("人"), "again", at(11)),
  review(card("大"), "again", at(39)),
  review(card("大"), "good", at(39, 1)),
];

describe("stats", () => {
  test("counts only reviews of cards past their learning steps in the last 30 days", () => {
    expect(run(LOG).retention).toEqual({ passed: 1, total: 3 });
  });

  test("does not depend on the log order", () => {
    expect(run([...LOG].reverse())).toEqual(run(LOG));
  });

  test("counts words as readings, and reviews and studied days in the last 30 days", () => {
    const { words, recent } = run(LOG);
    expect(words).toBe(3);
    expect(recent).toEqual({ reviews: 7, studiedDays: 5 });
  });

  test("lays out 12 weeks from Monday, ending with today's week", () => {
    const { weeks } = run([
      review(card("好"), "good", at(TODAY)),
      review(card("人"), "good", at(TODAY, 1)),
      review(card("大"), "good", at(TODAY - 1)),
      // 02:00 belongs to the day before.
      review(card("大"), "good", at(TODAY, -600)),
      review(card("小"), "good", at(TODAY - 84)),
    ]);
    expect(weeks).toHaveLength(HEATMAP_WEEKS);
    expect(weeks[0]?.start).toBe("2026-08-24");
    expect(weeks[0]?.days[0]).toEqual({ day: "2026-08-24", reviews: 0, words: 0, goalMet: false });
    expect(weeks.at(-1)).toEqual({
      start: "2026-11-09",
      days: [
        { day: "2026-11-09", reviews: 2, words: 2, goalMet: true },
        { day: "2026-11-10", reviews: 2, words: 2, goalMet: true },
        null,
        null,
        null,
        null,
        null,
      ],
    });
  });

  test("an empty log has no retention and empty days", () => {
    const { retention, words, recent, weeks } = run([]);
    expect({ retention, words, recent }).toEqual({
      retention: { passed: 0, total: 0 },
      words: 0,
      recent: { reviews: 0, studiedDays: 0 },
    });
    expect(weeks.flatMap(({ days }) => days).filter((day) => day !== null)).toHaveLength(79);
    expect(
      weeks.flatMap(({ days }) => days).every((day) => day === null || day.reviews === 0),
    ).toBe(true);
  });

  test("rejects a duplicate review or an invalid card id", () => {
    const first = review(card("好"), "good", at(1));
    expect(stats([first, first], at(TODAY), 0)).toEqual(
      err({ kind: "duplicate-review", reviewId: first.id }),
    );
    const broken = review("not a card id", "good", at(1));
    expect(stats([broken], at(TODAY), 0)).toEqual(
      err({ kind: "invalid-card-id", reviewId: broken.id }),
    );
  });
});
