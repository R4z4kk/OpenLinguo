import { describe, expect, test } from "vitest";
import { CURRENT_SCHEDULER } from "./fsrs.ts";
import { composeSession, type SessionCard, type SessionInput } from "./session.ts";
import {
  applyReview,
  cardId,
  learningDay,
  NEW_CARD_STATE,
  type CardState,
  type CardType,
  type Grade,
  type Subject,
  type WordKey,
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
const NOTE = { note: "Fx4k]?Lb!e" };

const idOf = (key: Subject, type: CardType): string => cardId({ language: "zh", ...key, type });

const card = (key: Subject, type: CardType, state: Partial<CardState>): SessionCard => ({
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
    toneWords: [],
    writingWords: [],
    typingWords: [],
    newLimit: 20,
    at: NOON,
    utcOffsetMinutes: OFFSET,
    ahead: false,
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

  test("tomorrow's session now: due by the end of tomorrow, one more day of new cards", () => {
    const cards = [
      card(HAO, "recognition", review(NOON + 3 * DAY, TODAY)),
      // Seen today through its other card: it waits for tomorrow all the same.
      card(HAO, "recall", review(NOON + DAY)),
      card(NI, "recognition", review(NOON + DAY)),
      card(SHUI, "recognition", review(NOON + 2 * DAY)),
    ];
    const input = { cards, newReadings: [TIAN, HUO], newLimit: 1 };
    expect(compose(input)).toEqual([]);
    expect(compose({ ...input, ahead: true })).toEqual([
      [idOf(NI, "recognition"), false],
      [idOf(TIAN, "recognition"), true],
    ]);
    // Once tomorrow's new card is started today, a second session ahead brings no more.
    const started = [...cards, card(TIAN, "recognition", review(NOON + 3 * DAY, TODAY))];
    expect(compose({ ...input, cards: started, ahead: true })).toEqual([
      [idOf(NI, "recognition"), false],
    ]);
  });

  test("a started word with audio gets its tone card among the waiting cards, before new words", () => {
    expect(
      compose({
        cards: [
          card(NI, "recognition", review(NOON + 3 * DAY, "2026-10-19")),
          card(NI, "recall", review(NOON + 3 * DAY, "2026-10-19")),
          card(HAO, "recognition", review(NOON + 3 * DAY, "2026-10-19")),
          card(HAO, "recall", {}),
        ],
        newReadings: [TIAN],
        toneWords: [NI, HAO],
      }),
    ).toEqual([
      [idOf(NI, "tone"), true],
      [idOf(HAO, "recall"), true],
      [idOf(TIAN, "recognition"), true],
    ]);
  });

  test("no tone card for a word that is not started, or has no audio or tone", () => {
    expect(
      compose({
        cards: [
          card(NI, "recognition", review(NOON + 3 * DAY, "2026-10-19")),
          card(HAO, "recognition", review(NOON + 3 * DAY, "2026-10-19")),
        ],
        newReadings: [TIAN],
        toneWords: [NI, TIAN],
      }),
    ).toEqual([
      [idOf(NI, "tone"), true],
      [idOf(TIAN, "recognition"), true],
    ]);
  });

  test("a stored tone card waits for its audio: not offered, due or not", () => {
    const cards = [
      card(NI, "recognition", review(NOON + 3 * DAY, "2026-10-19")),
      card(NI, "tone", review(NOON - HOUR, "2026-10-19")),
      card(HAO, "recognition", review(NOON + 3 * DAY, "2026-10-19")),
      card(HAO, "tone", {}),
    ];
    expect(compose({ cards, toneWords: [] })).toEqual([]);
    expect(compose({ cards, toneWords: [NI] })).toEqual([[idOf(NI, "tone"), false]]);
    expect(compose({ cards, toneWords: [NI, HAO] })).toEqual([
      [idOf(NI, "tone"), false],
      [idOf(HAO, "tone"), true],
    ]);
  });

  test("a tone card counts in the daily limit and shares the one card per day", () => {
    expect(
      compose({
        cards: [
          card(NI, "recognition", review(NOON + 3 * DAY, TODAY)),
          card(HAO, "recognition", review(NOON + 3 * DAY, "2026-10-19")),
          card(SHUI, "recognition", review(NOON + 3 * DAY, "2026-10-19")),
        ],
        toneWords: [NI, HAO, SHUI],
        newLimit: 2,
      }),
    ).toEqual([[idOf(HAO, "tone"), true]]);
  });

  test("a started word gets its writing and typing cards, one a day, from the new-card budget", () => {
    const cards = [
      card(NI, "recognition", review(NOON + 3 * DAY, "2026-10-19")),
      card(NI, "recall", review(NOON + 3 * DAY, "2026-10-19")),
      card(HAO, "recognition", review(NOON + 3 * DAY)),
      card(HAO, "recall", {}),
    ];
    const practised = { writingWords: [NI, HAO], typingWords: [NI, HAO] };
    expect(compose({ cards, newReadings: [TIAN], ...practised })).toEqual([
      [idOf(NI, "typing"), true],
      [idOf(HAO, "recall"), true],
      [idOf(TIAN, "recognition"), true],
    ]);
    expect(compose({ cards, newReadings: [TIAN], ...practised, newLimit: 1 })).toEqual([
      [idOf(NI, "typing"), true],
    ]);
  });

  test("no writing or typing card for a word that is not started, or not in their list", () => {
    expect(
      compose({
        cards: [
          card(NI, "recognition", review(NOON + 3 * DAY, "2026-10-19")),
          card(HAO, "recognition", review(NOON + 3 * DAY, "2026-10-19")),
        ],
        writingWords: [NI, TIAN],
        typingWords: [TIAN],
      }),
    ).toEqual([[idOf(NI, "writing"), true]]);
  });

  test("a writing or typing card started today keeps the word's other ones for tomorrow", () => {
    expect(
      compose({
        cards: [
          card(NI, "recognition", review(NOON + 3 * DAY, "2026-10-19")),
          card(NI, "writing", review(NOON + 3 * DAY, TODAY)),
        ],
        writingWords: [NI],
        typingWords: [NI],
        toneWords: [NI],
      }),
    ).toEqual([]);
  });

  test("turning a practice off hides its cards, due or new, and turning it on brings them back", () => {
    const cards = [
      card(NI, "recognition", review(NOON + 3 * DAY, "2026-10-19")),
      card(NI, "writing", review(NOON - HOUR, "2026-10-19")),
      card(HAO, "recognition", review(NOON + 3 * DAY, "2026-10-19")),
      card(HAO, "typing", {}),
    ];
    expect(compose({ cards })).toEqual([]);
    expect(compose({ cards, writingWords: [NI, HAO], typingWords: [NI, HAO] })).toEqual([
      [idOf(NI, "writing"), false],
      [idOf(HAO, "typing"), true],
    ]);
  });

  test("a note is composed like a word, one card per learning day", () => {
    expect(
      compose({
        cards: [
          card(NOTE, "recognition", review(NOON + 3 * DAY, TODAY)),
          card(NOTE, "recall", {}),
          card(HAO, "recognition", review(NOON + 3 * DAY)),
          card(HAO, "recall", {}),
        ],
        newReadings: [{ note: "other" }],
      }),
    ).toEqual([
      [idOf(HAO, "recall"), true],
      [idOf({ note: "other" }, "recognition"), true],
    ]);
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
