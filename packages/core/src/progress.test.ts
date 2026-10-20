import { describe, expect, test } from "vitest";
import { CURRENT_SCHEDULER } from "./fsrs.ts";
import { levelOf, levelStart, progress } from "./progress.ts";
import { cardId, type CardType, type Grade, type Review } from "./srs.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const START = Date.UTC(2026, 9, 1, 12);

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const card = (headword: string, type: CardType = "recognition"): string =>
  cardId({ language: "zh", headword, readingKey: "r", type });
const at = (day: number, minutes = 0): number => START + day * DAY + minutes * MINUTE;
const days = (from: number, to: number): number[] =>
  Array.from({ length: to - from }, (_, index) => from + index);

const review = (n: number, reviewedAt: number, fields: Partial<Review> = {}): Review => ({
  id: uuid(n),
  cardId: card("好"),
  grade: "good",
  reviewedAt,
  utcOffsetMinutes: 0,
  scheduler: CURRENT_SCHEDULER,
  dailyGoal: 2,
  wordDone: null,
  ...fields,
});

/** Two reviews each day, meeting the goal of 2. */
const metOn = (...met: number[]): Review[] =>
  met.flatMap((day) => [review(day * 2, at(day)), review(day * 2 + 1, at(day, 1))]);

const run = (log: readonly Review[], today: number) => {
  const result = progress(log, at(today), 0);
  if (!result.ok) throw new Error(result.error.kind);
  return result.value;
};

const streak = (log: readonly Review[], today: number) => {
  const { streak: current, freezes, totals } = run(log, today);
  return { current, freezes, longest: totals.longestStreak };
};

describe("levels", () => {
  test.each([
    [0, 1],
    [99, 1],
    [100, 2],
    [399, 2],
    [400, 3],
    [8_099, 9],
    [8_100, 10],
  ])("%i XP is level %i", (xp, level) => {
    expect(levelOf(xp)).toBe(level);
    expect(levelStart(level)).toBeLessThanOrEqual(xp);
  });
});

describe("progress", () => {
  test("an empty log is level 1 with nothing earned", () => {
    expect(progress([], START, 0)).toEqual({
      ok: true,
      value: {
        xp: 0,
        level: 1,
        streak: 0,
        freezes: 0,
        totals: { reviews: 0, words: 0, longestStreak: 0, goalDays: 0 },
        achievements: [],
      },
    });
  });

  test("every grade earns 10 XP", () => {
    const grades: Grade[] = ["again", "hard", "good", "easy"];
    const log = grades.map((grade, n) => review(n, at(0, n), { grade }));
    expect(run(log, 0)).toMatchObject({ xp: 40, level: 1 });
  });

  test("the same log in any order gives the same progress", () => {
    const log = metOn(...days(0, 10));
    expect(run(log.toReversed(), 12)).toEqual(run(log, 12));
  });

  test("a word's recognition and recall count as one word", () => {
    const log = [
      review(1, at(0), { cardId: card("好") }),
      review(2, at(0, 1), { cardId: card("好", "recall") }),
      review(3, at(0, 2), { cardId: card("猫") }),
      review(4, at(0, 3), { cardId: cardId({ language: "zh", note: "猫", type: "recall" }) }),
    ];
    expect(run(log, 0).totals).toMatchObject({ reviews: 4, words: 3 });
  });

  test("rejects a duplicate review and an invalid card id", () => {
    expect(progress([review(1, at(0)), review(1, at(1))], at(1), 0)).toEqual({
      ok: false,
      error: { kind: "duplicate-review", reviewId: uuid(1) },
    });
    expect(progress([review(1, at(0), { cardId: "好" })], at(0), 0)).toEqual({
      ok: false,
      error: { kind: "invalid-card-id", reviewId: uuid(1) },
    });
  });
});

describe("daily goal", () => {
  test("a lowered goal counts at the next review, a raised one never unmeets the day", () => {
    const unmet = [review(1, at(0), { dailyGoal: 5 }), review(2, at(0, 1), { dailyGoal: 5 })];
    expect(run(unmet, 0).totals.goalDays).toBe(0);
    expect(run([...unmet, review(3, at(0, 2), { dailyGoal: 3 })], 0).totals.goalDays).toBe(1);
    expect(run([...metOn(0), review(9, at(0, 2), { dailyGoal: 10 })], 0).totals.goalDays).toBe(1);
  });

  test("a session emptied below the goal stamps the day's count and keeps the streak", () => {
    const cleared = [review(5, at(1), { dailyGoal: 20 }), review(6, at(1, 1), { dailyGoal: 2 })];
    expect(run([...metOn(0), ...cleared], 2)).toMatchObject({
      streak: 2,
      totals: { goalDays: 2 },
    });
  });

  test("a word counts once done, however many passes it took; XP stays per review", () => {
    const passes = [
      review(1, at(0), { wordDone: false }),
      review(2, at(0, 10), { wordDone: true }),
      review(3, at(0, 11), { cardId: card("人"), wordDone: false }),
    ];
    expect(run(passes, 0)).toMatchObject({ xp: 30, totals: { goalDays: 0 } });
    const done = review(4, at(0, 21), { cardId: card("人"), wordDone: true });
    expect(run([...passes, done], 0)).toMatchObject({ xp: 40, streak: 1, totals: { goalDays: 1 } });
  });

  test("a word done through two of its cards counts once a day", () => {
    const twice = [
      review(1, at(0), { wordDone: true }),
      review(2, at(0, 1), { cardId: card("好", "recall"), wordDone: true }),
    ];
    expect(run(twice, 0).totals.goalDays).toBe(0);
    expect(run([...twice, review(3, at(1), { wordDone: true })], 1).totals.goalDays).toBe(0);
  });

  test("reviews logged before words were counted keep counting one each", () => {
    const wordDay = [
      review(9, at(1), { wordDone: false }),
      review(10, at(1, 10), { wordDone: true }),
    ];
    expect(run([...metOn(0), ...wordDay], 1)).toMatchObject({ streak: 1, totals: { goalDays: 1 } });
    const mixed = [review(11, at(2)), review(12, at(2, 1), { cardId: card("人"), wordDone: true })];
    expect(run([...metOn(0), ...wordDay, ...mixed], 2).totals.goalDays).toBe(2);
  });

  test("a learning day starts at 4:00 local time", () => {
    const paris = { utcOffsetMinutes: 120 };
    const log = [
      review(1, Date.UTC(2026, 9, 1, 21), paris),
      review(2, Date.UTC(2026, 9, 2, 1, 30), paris),
      review(3, Date.UTC(2026, 9, 2, 2), paris),
    ];
    expect(run(log, 1)).toMatchObject({ streak: 1, totals: { goalDays: 1 } });
  });
});

describe("streak", () => {
  test("counts met days in a row and waits for today", () => {
    const log = [...metOn(0, 1, 2), review(9, at(3))];
    expect(streak(log, 3)).toEqual({ current: 3, freezes: 0, longest: 3 });
    expect(streak(log, 4)).toEqual({ current: 0, freezes: 0, longest: 3 });
  });

  test("7 streak days earn a freeze, used on the next missed day", () => {
    const week = metOn(...days(0, 7));
    expect(streak(week, 7)).toEqual({ current: 7, freezes: 1, longest: 7 });
    expect(streak(week, 8)).toEqual({ current: 7, freezes: 0, longest: 7 });
    expect(streak(week, 9)).toEqual({ current: 0, freezes: 0, longest: 7 });
    expect(streak(metOn(...days(0, 7), 8), 8)).toEqual({ current: 8, freezes: 0, longest: 8 });
  });

  test("at most 2 freezes are held", () => {
    const log = metOn(...days(0, 21));
    expect(streak(log, 21)).toEqual({ current: 21, freezes: 2, longest: 21 });
    expect(streak(log, 23)).toEqual({ current: 21, freezes: 0, longest: 21 });
    expect(streak(log, 24)).toEqual({ current: 0, freezes: 0, longest: 21 });
  });
});

describe("achievements", () => {
  test("unlock at their thresholds and stay once the streak ends", () => {
    const words = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    const log = days(0, 10).flatMap((day) =>
      words.map((headword, n) =>
        review(day * 10 + n, at(day, n), { cardId: card(headword), dailyGoal: 10 }),
      ),
    );
    const unlocked = ["reviews-1", "reviews-100", "words-10", "longestStreak-7", "goalDays-10"];
    expect(run(log, 9)).toEqual({
      xp: 1_000,
      level: 4,
      streak: 10,
      freezes: 1,
      totals: { reviews: 100, words: 10, longestStreak: 10, goalDays: 10 },
      achievements: unlocked,
    });
    expect(run(log, 15)).toMatchObject({ streak: 0, achievements: unlocked });
  });
});
