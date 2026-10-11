import { describe, expect, test } from "vitest";
import { CURRENT_SCHEDULER } from "./fsrs.ts";
import { composeSession, type SessionCard, type SessionInput, type WordKey } from "./session.ts";
import {
  applyReview,
  cardId,
  learningDay,
  NEW_CARD_STATE,
  type CardState,
  type CardType,
  type Grade,
} from "./srs.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const OFFSET = 120;
// Paris summer, 12:00 on 2026-10-21.
const NOON = Date.UTC(2026, 9, 21, 10);
const TODAY = learningDay(NOON, OFFSET);
const YESTERDAY = "2026-10-20";

const word = (headword: string, readingKey: string): WordKey => ({ headword, readingKey });
const HAO = word("好", "hao3");
const NI = word("你", "ni3");
const TIAN = word("天", "tian1");
const SHUI = word("水", "shui3");
const HUO = word("火", "huo3");

const idOf = (key: WordKey, type: CardType): string => cardId({ language: "zh", ...key, type });

const card = (key: WordKey, type: CardType, state: Partial<CardState>): SessionCard => ({
  ...key,
  id: idOf(key, type),
  type,
  ...NEW_CARD_STATE,
  ...state,
});

const review = (due: number, firstReviewDay = YESTERDAY): Partial<CardState> => ({
  phase: "review",
  due,
  firstReviewDay,
  lastReviewDay: firstReviewDay,
});

const compose = (input: Partial<SessionInput>) =>
  composeSession({
    language: "zh",
    cards: [],
    newReadings: [],
    newLimit: 20,
    at: NOON,
    utcOffsetMinutes: OFFSET,
    ...input,
  }).map(({ cardId, new: isNew }) => [cardId, isNew] as const);

describe("composeSession", () => {
  test("due cards come first, most overdue first, then new words recognition first", () => {
    expect(
      compose({
        cards: [
          card(NI, "recognition", review(NOON + 8 * HOUR)),
          card(HAO, "recognition", review(NOON - DAY)),
          card(TIAN, "recognition", {
            ...review(NOON + 10 * MINUTE, TODAY),
            phase: "learning",
          }),
          card(SHUI, "recognition", review(NOON + 2 * DAY)),
        ],
        newReadings: [HUO],
      }),
    ).toEqual([
      [idOf(HAO, "recognition"), false],
      [idOf(TIAN, "recognition"), false],
      [idOf(NI, "recognition"), false],
      [idOf(HUO, "recognition"), true],
    ]);
  });

  test("a word shows one card per learning day", () => {
    expect(
      compose({
        cards: [
          // Reviewed today and due again: only this card of 好.
          card(HAO, "recognition", { ...review(NOON + 10 * MINUTE, TODAY), phase: "learning" }),
          card(HAO, "recall", review(NOON - HOUR)),
          // Both due: the most overdue one.
          card(NI, "recognition", review(NOON - HOUR)),
          card(NI, "recall", review(NOON - DAY)),
          // Reviewed today, not due again: its second card waits for tomorrow.
          card(TIAN, "recognition", review(NOON + 3 * DAY, TODAY)),
          card(TIAN, "recall", {}),
        ],
      }),
    ).toEqual([
      [idOf(NI, "recall"), false],
      [idOf(HAO, "recognition"), false],
    ]);
  });

  test("the second card of a started word comes before new words, oldest word first", () => {
    expect(
      compose({
        cards: [
          card(NI, "recognition", review(NOON + 3 * DAY)),
          card(NI, "recall", {}),
          card(HAO, "recognition", review(NOON + 3 * DAY, "2026-10-19")),
          card(HAO, "recall", {}),
        ],
        newReadings: [TIAN],
      }),
    ).toEqual([
      [idOf(HAO, "recall"), true],
      [idOf(NI, "recall"), true],
      [idOf(TIAN, "recognition"), true],
    ]);
  });

  test("new cards stop at the daily limit, counting those started today", () => {
    expect(
      compose({
        cards: [
          card(HAO, "recognition", review(NOON + 3 * DAY, TODAY)),
          card(NI, "recognition", review(NOON + 3 * DAY, TODAY)),
        ],
        newReadings: [TIAN, SHUI, HUO],
        newLimit: 3,
      }),
    ).toEqual([[idOf(TIAN, "recognition"), true]]);
    expect(compose({ newReadings: [TIAN], newLimit: 0 })).toEqual([]);
  });
});

test("over simulated days, the second card waits for the 4:00 rollover", () => {
  let recognition: CardState = NEW_CARD_STATE;
  const grade = (at: number, value: Grade): void => {
    const next = applyReview(recognition, {
      grade: value,
      reviewedAt: at,
      utcOffsetMinutes: OFFSET,
      scheduler: CURRENT_SCHEDULER,
    });
    if (!next.ok) throw new Error(next.error.message);
    recognition = next.value;
  };
  const session = (at: number) =>
    compose({
      at,
      cards: [card(HAO, "recognition", recognition), card(HAO, "recall", {})],
      newReadings: recognition.phase === "new" ? [HAO] : [],
    });

  const evening = Date.UTC(2026, 9, 21, 19);
  expect(session(evening)).toEqual([[idOf(HAO, "recognition"), true]]);
  grade(evening, "good");
  expect(session(evening + 10 * MINUTE)).toEqual([[idOf(HAO, "recognition"), false]]);
  grade(evening + 10 * MINUTE, "good");
  expect(recognition.phase).toBe("review");
  // 03:59 in Paris is still 2026-10-21.
  expect(session(Date.UTC(2026, 9, 22, 1, 59))).toEqual([]);
  expect(session(Date.UTC(2026, 9, 22, 2))).toEqual([[idOf(HAO, "recall"), true]]);
});
