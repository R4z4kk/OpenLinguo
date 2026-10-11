import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade as FsrsGrade,
} from "ts-fsrs";
import { describe, expect, test } from "vitest";
import { CURRENT_SCHEDULER, SCHEDULER_PARAMETERS } from "./fsrs.ts";
import {
  applyReview,
  NEW_CARD_STATE,
  replay,
  type CardState,
  type Grade,
  type Phase,
  type Review,
} from "./srs.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

test("fsrs6-v1 is the ts-fsrs defaults; changed defaults need a new scheduler version", () => {
  expect(SCHEDULER_PARAMETERS["fsrs6-v1"]).toEqual(generatorParameters());
});

type Scheduler = {
  readonly due: (card: string) => number | null;
  readonly review: (card: string, at: number, offset: number, grade: Grade) => CardState;
};

type Learner = {
  readonly offset: (at: number) => number;
  /** Local start times as `[hour, minute]`; hours past 23 fall on the next date. */
  readonly sessions: readonly (readonly [number, number])[];
};

const paris: Learner = {
  offset: (at) => (at < Date.UTC(2026, 9, 25, 1) ? 120 : 60),
  sessions: [
    [8, 0],
    [27, 50],
  ],
};

const shanghai: Learner = {
  offset: () => 480,
  sessions: [
    [7, 45],
    [21, 0],
  ],
};

const CARDS = Array.from({ length: 14 }, (_, index) => `card-${String(index).padStart(2, "0")}`);
const GRADES: readonly Grade[] = ["good", "good", "again", "good", "hard", "easy"];

type Event = { readonly card: string; readonly at: number; readonly grade: Grade } & CardState;

/** Seven days from 2026-10-21 (Paris leaves summer time on the 25th), one new card per session. */
const simulate = (learner: Learner, scheduler: Scheduler): readonly Event[] => {
  const events: Event[] = [];
  const started: string[] = [];
  for (let day = 0; day < 7; day += 1) {
    for (const [hour, minute] of learner.sessions) {
      const wall = Date.UTC(2026, 9, 21 + day, hour, minute);
      let now = wall - learner.offset(wall - learner.offset(wall) * MINUTE) * MINUTE;
      const end = now + 30 * MINUTE;
      const card = CARDS[started.length];
      if (card) started.push(card);
      for (;;) {
        const dues = started
          .map((card) => ({ card, due: scheduler.due(card) ?? now }))
          .sort((a, b) => a.due - b.due || a.card.localeCompare(b.card));
        const next = dues.find(({ due }) => due <= now);
        if (next) {
          const grade = GRADES[events.length % GRADES.length] ?? "good";
          const offset = learner.offset(now);
          events.push({
            card: next.card,
            at: now,
            grade,
            ...scheduler.review(next.card, now, offset, grade),
          });
          now += 20_000;
          continue;
        }
        const upcoming = dues.find(({ due }) => due <= end);
        if (!upcoming) break;
        now = upcoming.due;
      }
    }
  }
  return events;
};

const viaCore = (log: Review[], states: Map<string, CardState>): Scheduler => ({
  due: (card) => states.get(card)?.due ?? null,
  review: (card, at, offset, grade) => {
    const review: Review = {
      id: `00000000-0000-4000-8000-${log.length.toString(16).padStart(12, "0")}`,
      cardId: card,
      grade,
      reviewedAt: at,
      utcOffsetMinutes: offset,
      scheduler: CURRENT_SCHEDULER,
    };
    const next = applyReview(states.get(card) ?? NEW_CARD_STATE, review);
    if (!next.ok) throw new Error(next.error.message);
    log.push(review);
    states.set(card, next.value);
    return next.value;
  },
});

const PHASE: Readonly<Record<State, Phase>> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

const RATING: Readonly<Record<Grade, FsrsGrade>> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

/** ts-fsrs with its own defaults, given the local time minus the 4:00 rollover. */
const viaTsFsrs = (): Scheduler => {
  const scheduler = fsrs();
  const cards = new Map<
    string,
    { readonly card: FsrsCard; readonly due: number; readonly firstDay: string }
  >();
  return {
    due: (card) => cards.get(card)?.due ?? null,
    review: (id, at, offset, grade) => {
      const clock = new Date(at + offset * MINUTE - 4 * HOUR);
      const card = scheduler.next(
        cards.get(id)?.card ?? createEmptyCard(clock),
        clock,
        RATING[grade],
      ).card;
      const due = at + card.due.getTime() - clock.getTime();
      const day = clock.toISOString().slice(0, 10);
      const firstDay = cards.get(id)?.firstDay ?? day;
      cards.set(id, { card, due, firstDay });
      return {
        phase: PHASE[card.state],
        due,
        stability: card.stability,
        difficulty: card.difficulty,
        reps: card.reps,
        lapses: card.lapses,
        learningSteps: card.learning_steps,
        scheduledDays: card.scheduled_days,
        firstReviewDay: firstDay,
        lastReviewDay: day,
      };
    },
  };
};

describe.each([
  ["Paris, across the end of summer time and the 4:00 rollover", paris],
  ["Shanghai, across the UTC midnight", shanghai],
])("7-day simulation: %s", (_, learner) => {
  const log: Review[] = [];
  const states = new Map<string, CardState>();
  const events = simulate(learner, viaCore(log, states));

  test("is a real schedule", () => {
    expect(events.length).toBeGreaterThan(40);
    expect(new Set(events.map(({ phase }) => phase))).toEqual(
      new Set(["learning", "review", "relearning"]),
    );
  });

  test("matches ts-fsrs called directly, review by review", () => {
    expect(events).toEqual(simulate(learner, viaTsFsrs()));
  });

  test("replaying each card's log gives its cached state", () => {
    for (const [card, state] of states) {
      expect(
        replay(
          card,
          log.filter(({ cardId }) => cardId === card),
        ),
      ).toEqual({
        ok: true,
        value: state,
      });
    }
  });
});
