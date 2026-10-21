import { describe, expect, test } from "vitest";
import {
  coverage,
  knowledgeOf,
  knownWords,
  type Occurrence,
  type KnownWordsCard,
  type KnownWordsInput,
} from "./coverage.ts";
import { CURRENT_SCHEDULER } from "./fsrs.ts";
import {
  applyReview,
  NEW_CARD_STATE,
  type CardState,
  type CardType,
  type Grade,
  type WordKey,
} from "./srs.ts";

const DAY = 24 * 60 * 60_000;

const word = (headword: string, readingKey: string): WordKey => ({ headword, readingKey });
const HAO = word("好", "hao3");
const XING = word("行", "xing2");
const HANG = word("行", "hang2");

const after = (grades: readonly Grade[]): CardState => {
  let state = NEW_CARD_STATE;
  grades.forEach((grade, index) => {
    const next = applyReview(state, {
      grade,
      reviewedAt: Date.UTC(2026, 9, 1) + index * DAY,
      utcOffsetMinutes: 0,
      scheduler: CURRENT_SCHEDULER,
    });
    if (!next.ok) throw new Error(next.error.kind);
    state = next.value;
  });
  return state;
};

const IN_LEARNING = after(["good"]);
const IN_REVIEW = after(["good", "good"]);
const IN_RELEARNING = after(["good", "good", "again"]);

const card = (
  key: WordKey,
  state: CardState,
  type: CardType = "recognition",
  language: KnownWordsCard["language"] = "zh",
): KnownWordsCard => ({ ...key, language, type, phase: state.phase });

const build = (input: Partial<KnownWordsInput>) =>
  knownWords({ language: "zh", cards: [], marks: [], names: [], ...input });

const seen = (text: string, readingKey: string | null): Occurrence => ({
  text,
  isWord: true,
  readingKey,
});
const HAO_SEEN = seen("好", "hao3");

describe("scheduler phases used by the tests", () => {
  test("a card stays in its learning steps until it graduates", () => {
    expect([IN_LEARNING.phase, IN_REVIEW.phase, IN_RELEARNING.phase]).toEqual([
      "learning",
      "review",
      "relearning",
    ]);
  });
});

describe("knowledgeOf", () => {
  test.each([
    ["review", IN_REVIEW, "known"],
    ["relearning", IN_RELEARNING, "known"],
    ["learning", IN_LEARNING, "learning"],
    ["new", NEW_CARD_STATE, "unknown"],
  ] as const)("a card in %s makes the reading %s", (_phase, state, expected) => {
    const vocab = build({ cards: [card(HAO, state)] });
    expect(knowledgeOf(vocab, HAO_SEEN)).toBe(expected);
  });

  test("a word without a card is unknown", () => {
    expect(knowledgeOf(build({}), HAO_SEEN)).toBe("unknown");
  });

  test("a mark makes the reading known with no card", () => {
    expect(knowledgeOf(build({ marks: [HAO] }), HAO_SEEN)).toBe("known");
  });

  test("a mark wins over a card in its learning steps", () => {
    const vocab = build({ cards: [card(HAO, IN_LEARNING)], marks: [HAO] });
    expect(knowledgeOf(vocab, HAO_SEEN)).toBe("known");
  });

  test("a card past its learning steps wins over one still in them", () => {
    const vocab = build({
      cards: [card(HAO, IN_LEARNING, "recognition"), card(HAO, IN_REVIEW, "typing")],
    });
    expect(knowledgeOf(vocab, HAO_SEEN)).toBe("known");
  });

  test("a reading is known on its own: another reading of the characters is not", () => {
    const vocab = build({ cards: [card(XING, IN_REVIEW)], marks: [HAO] });
    expect(knowledgeOf(vocab, seen("行", "xing2"))).toBe("known");
    expect(knowledgeOf(vocab, seen("行", "hang2"))).toBe("unknown");
  });

  test("the reading in effect decides, not the first reading", () => {
    const vocab = build({ cards: [card(HANG, IN_REVIEW)] });
    expect(knowledgeOf(vocab, seen("行", "xing2"))).toBe("unknown");
    expect(knowledgeOf(vocab, seen("行", "hang2"))).toBe("known");
  });

  test("a word the dictionary has no reading for is unknown", () => {
    expect(knowledgeOf(build({ marks: [HAO] }), seen("好", null))).toBe("unknown");
  });

  test("a validated proper name is known by its text, with no reading", () => {
    const vocab = build({ names: ["王小红"] });
    expect(knowledgeOf(vocab, seen("王小红", null))).toBe("known");
    expect(knowledgeOf(vocab, seen("王小", null))).toBe("unknown");
  });

  test("ignores the cards of notes and of another language", () => {
    const vocab = build({
      cards: [
        { note: "n1", language: "zh", type: "recognition", phase: "review" },
        card(HAO, IN_REVIEW, "recognition", "en"),
      ],
    });
    expect(knowledgeOf(vocab, HAO_SEEN)).toBe("unknown");
  });
});

describe("coverage", () => {
  test("counts known Han word tokens over Han word tokens, per occurrence", () => {
    const vocab = build({ marks: [HAO] });
    const text = [HAO_SEEN, seen("天", "tian1"), HAO_SEEN, HAO_SEEN];
    expect(coverage(text, vocab)).toEqual({ known: 3, total: 4, unknownWords: 1 });
  });

  test("leaves out punctuation, Latin letters and digits", () => {
    const text: readonly Occurrence[] = [
      HAO_SEEN,
      { text: "。", isWord: false, readingKey: null },
      { text: " ", isWord: false, readingKey: null },
      { text: "iPhone", isWord: true, readingKey: null },
      { text: "15", isWord: true, readingKey: null },
    ];
    expect(coverage(text, build({ marks: [HAO] }))).toEqual({
      known: 1,
      total: 1,
      unknownWords: 0,
    });
  });

  test("counts validated proper names as known", () => {
    const text = [seen("王小红", null), HAO_SEEN, seen("王小红", null)];
    expect(coverage(text, build({ names: ["王小红"] }))).toEqual({
      known: 2,
      total: 3,
      unknownWords: 1,
    });
  });

  test("counts each unknown word once, by characters and reading", () => {
    const text = [
      seen("行", "xing2"),
      seen("行", "xing2"),
      seen("行", "hang2"),
      seen("天", "tian1"),
      seen("天", "tian1"),
    ];
    expect(coverage(text, build({})).unknownWords).toBe(3);
  });

  test("counts a word in its learning steps as unknown", () => {
    const vocab = build({ cards: [card(HAO, IN_LEARNING)] });
    expect(coverage([HAO_SEEN, HAO_SEEN], vocab)).toEqual({
      known: 0,
      total: 2,
      unknownWords: 1,
    });
  });

  test("counts each unknown word without a reading by its characters", () => {
    const text = [seen("𠮷", null), seen("𠮷", null), seen("䶮", null)];
    expect(coverage(text, build({})).unknownWords).toBe(2);
  });

  test("is all zeros for a text without Han words", () => {
    const text: readonly Occurrence[] = [
      { text: "。", isWord: false, readingKey: null },
      { text: "iPhone", isWord: true, readingKey: null },
    ];
    expect(coverage(text, build({}))).toEqual({ known: 0, total: 0, unknownWords: 0 });
    expect(coverage([], build({}))).toEqual({ known: 0, total: 0, unknownWords: 0 });
  });
});
