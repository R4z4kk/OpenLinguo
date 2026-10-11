import { describe, expect, test } from "vitest";
import { CURRENT_SCHEDULER } from "./fsrs.ts";
import {
  applyReview,
  Card,
  cardId,
  CardState,
  dueToday,
  learningDay,
  NEW_CARD_STATE,
  newCards,
  previewGrades,
  replay,
  Review,
  type Grade,
} from "./srs.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const HAO = cardId({ language: "zh", headword: "好", readingKey: "hao3", type: "recognition" });

const review = (n: number, reviewedAt: number, grade: Grade, utcOffsetMinutes = 120): Review => ({
  id: uuid(n),
  cardId: HAO,
  grade,
  reviewedAt,
  utcOffsetMinutes,
  scheduler: CURRENT_SCHEDULER,
});

const start = Date.UTC(2026, 9, 21, 6);
const log: readonly Review[] = [
  review(1, start, "good"),
  review(2, start + 10 * MINUTE, "good"),
  review(3, start + 2 * DAY, "again"),
  review(4, start + 2 * DAY + 10 * MINUTE, "hard"),
  review(5, start + 3 * DAY, "easy"),
];

describe("learningDay", () => {
  test.each([
    ["Paris 03:59", Date.UTC(2026, 9, 21, 1, 59), 120, "2026-10-20"],
    ["Paris 04:00", Date.UTC(2026, 9, 21, 2, 0), 120, "2026-10-21"],
    ["Shanghai 07:50, before the UTC midnight", Date.UTC(2026, 9, 20, 23, 50), 480, "2026-10-21"],
    ["New York 23:30", Date.UTC(2026, 9, 21, 3, 30), -240, "2026-10-20"],
    ["Kathmandu 03:59", Date.UTC(2026, 9, 20, 22, 14), 345, "2026-10-20"],
    ["Kathmandu 04:00", Date.UTC(2026, 9, 20, 22, 15), 345, "2026-10-21"],
  ])("%s", (_, at, offset, day) => {
    expect(learningDay(at, offset)).toBe(day);
  });
});

describe("cards", () => {
  test("one recognition and one recall card per reading, with derived ids", () => {
    expect(newCards("zh", "好", "hao3")).toEqual([
      {
        id: '["zh","好","hao3","recognition"]',
        language: "zh",
        headword: "好",
        readingKey: "hao3",
        type: "recognition",
      },
      {
        id: '["zh","好","hao3","recall"]',
        language: "zh",
        headword: "好",
        readingKey: "hao3",
        type: "recall",
      },
    ]);
  });

  test("the schema rejects an id that does not derive from the card", () => {
    const card = { language: "zh", headword: "好", readingKey: "hao4", type: "recall" } as const;
    expect(Card.safeParse({ ...card, id: cardId(card) }).success).toBe(true);
    expect(Card.safeParse({ ...card, id: HAO }).success).toBe(false);
  });
});

describe("Review", () => {
  const valid = review(1, start, "good");

  test("accepts a review", () => {
    expect(Review.parse(valid)).toEqual(valid);
  });

  test.each([
    ["a non-uuid id", { id: "1" }],
    ["an offset beyond UTC+14", { utcOffsetMinutes: 15 * 60 }],
    ["a fractional time", { reviewedAt: start + 0.5 }],
    ["an unknown scheduler", { scheduler: "fsrs6-v2" }],
    ["an unknown grade", { grade: "perfect" }],
  ])("rejects %s", (_, change) => {
    expect(Review.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});

describe("replay", () => {
  test("a card without reviews is new", () => {
    expect(replay(HAO, [])).toEqual({ ok: true, value: NEW_CARD_STATE });
  });

  test("the cache built review by review equals the replay, also after a JSON round trip", () => {
    let cache = NEW_CARD_STATE;
    for (const entry of log) {
      const next = applyReview(cache, entry);
      if (!next.ok) throw new Error(next.error.message);
      cache = CardState.parse(JSON.parse(JSON.stringify(next.value)));
    }
    expect(cache.reps).toBe(log.length);
    expect(cache).toMatchObject({ firstReviewDay: "2026-10-21", lastReviewDay: "2026-10-24" });
    expect(replay(HAO, log)).toEqual({ ok: true, value: cache });
  });

  test("the log order does not matter", () => {
    expect(replay(HAO, [...log].reverse())).toEqual(replay(HAO, log));
  });

  test("reviews at the same time are ordered by id", () => {
    const tied = [review(7, start, "again"), review(6, start, "easy")];
    expect(replay(HAO, tied)).toEqual(replay(HAO, tied.toReversed()));
  });

  test("rejects a duplicate review", () => {
    expect(replay(HAO, [...log, review(3, start, "good")])).toEqual({
      ok: false,
      error: { kind: "duplicate-review", reviewId: uuid(3) },
    });
  });

  test("rejects a review of another card", () => {
    expect(replay(HAO, [...log, { ...review(9, start, "good"), cardId: "other" }])).toEqual({
      ok: false,
      error: { kind: "foreign-review", reviewId: uuid(9) },
    });
  });

  test("a review older than the cache is refused, so the caller replays", () => {
    const cache = replay(HAO, log);
    if (!cache.ok) throw new Error(cache.error.kind);
    const late = applyReview(cache.value, review(8, start + DAY, "good"));
    expect(late.ok || late.error.kind).toBe("scheduler-failure");
  });
});

test("FSRS counts learning days, not UTC days", () => {
  const first = Date.UTC(2026, 9, 20, 23, 50);
  const second = first + 20 * MINUTE;
  const state = replay(HAO, [review(1, first, "good", 480), review(2, second, "good", 480)]);
  if (!state.ok) throw new Error(state.error.kind);
  expect(state.value).toMatchObject({ phase: "review", scheduledDays: 2, due: second + 2 * DAY });
});

describe("previewGrades", () => {
  test("gives each grade's due time, in grade order, without storing anything", () => {
    const outcomes = previewGrades(NEW_CARD_STATE, start, 120);
    if (!outcomes.ok) throw new Error(outcomes.error.message);
    expect(outcomes.value.map(({ grade }) => grade)).toEqual(["again", "hard", "good", "easy"]);
    const [again, , good] = outcomes.value;
    expect(again?.due).toBe(start + MINUTE);
    expect(good?.due).toBe(start + 10 * MINUTE);
    const dues = outcomes.value.map(({ due }) => due);
    expect(dues).toEqual([...dues].sort((a, b) => a - b));
  });

  test("matches the review it previews", () => {
    const cache = replay(HAO, log.slice(0, 2));
    if (!cache.ok) throw new Error(cache.error.kind);
    const at = start + 4 * DAY;
    const hard = previewGrades(cache.value, at, 120);
    const reviewed = applyReview(cache.value, review(6, at, "hard"));
    if (!hard.ok || !reviewed.ok) throw new Error("scheduler failure");
    expect(hard.value[1]).toEqual({ grade: "hard", due: reviewed.value.due });
  });
});

describe("dueToday", () => {
  const noon = Date.UTC(2026, 9, 21, 10);
  test.each([
    ["overdue", noon - DAY, true],
    ["before the next 4:00 rollover", Date.UTC(2026, 9, 22, 1, 59), true],
    ["at the rollover", Date.UTC(2026, 9, 22, 2), false],
    ["never reviewed", null, false],
  ])("%s", (_, due, expected) => {
    expect(dueToday(due, noon, 120)).toBe(expected);
  });
});
