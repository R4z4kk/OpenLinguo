import "fake-indexeddb/auto";
import {
  applyReview,
  cardId,
  CURRENT_SCHEDULER,
  inMemoryDictionary,
  NEW_CARD_STATE,
  ok,
  type CardKey,
  type CardState,
  type DictEntry,
  type Grade,
} from "@openlinguo/core";
import { createZhPack } from "@openlinguo/lang-zh";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "./database.ts";
import {
  describeCoverageFailure,
  loadKnownWords,
  measureText,
  wordsToLearn,
} from "./text-coverage.ts";

const DAY = 24 * 60 * 60_000;

const entry = (headword: string, reading: string): DictEntry => ({
  headword,
  variants: [],
  reading,
  glosses: [],
  level: null,
});
const entries = [
  entry("我们", "wo3 men5"),
  entry("去", "qu4"),
  entry("学校", "xue2 xiao4"),
  entry("行", "xing2"),
  entry("行", "hang2"),
];
const pack = createZhPack({
  lookup: inMemoryDictionary(entries),
  lexicon: new Set(entries.map(({ headword }) => headword)),
  proficiency: "hsk-2025",
  decompositions: new Map(),
  strokesOf: () => Promise.resolve(ok(null)),
  wordsOfPinyin: () => Promise.resolve(ok([])),
});
const reading = pack.features.textReading;
if (reading === null) throw new Error("the zh pack reads texts");

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

const card = (headword: string, readingKey: string, state: CardState) => {
  const key: CardKey = { language: "zh", headword, readingKey, type: "recognition" };
  return { ...key, id: cardId(key), ...state };
};

let db: Database;
let counter = 0;

beforeEach(() => {
  counter += 1;
  db = openDatabase(`text-coverage-test-${String(counter)}`);
});

describe("loadKnownWords", () => {
  it("knows readings in review or relearning, marked readings, and calls a card in its steps learning", async () => {
    await db.cards.bulkAdd([
      card("去", "qu4", after(["good", "good"])),
      card("学校", "xue2 xiao4", after(["good"])),
      card("我们", "wo3 men5", NEW_CARD_STATE),
    ]);
    await db.knownMarks.add({ headword: "行", readingKey: "hang2", markedAt: 1 });
    const known = await loadKnownWords(db, "zh");
    expect(known.ok && [...known.value.words]).toEqual(
      expect.arrayContaining([
        [JSON.stringify(["去", "qu4"]), "known"],
        [JSON.stringify(["行", "hang2"]), "known"],
        [JSON.stringify(["学校", "xue2 xiao4"]), "learning"],
      ]),
    );
    expect(known.ok && known.value.words.size).toBe(3);
  });
});

describe("measureText", () => {
  it("counts known words over the words of the text, and the words still to learn", async () => {
    await db.cards.add(card("去", "qu4", after(["good", "good"])));
    const known = await loadKnownWords(db, "zh");
    if (!known.ok) throw new Error(known.error.kind);
    const measured = await measureText(reading, known.value, {
      body: "我们去学校。",
      readingChoices: {},
    });
    expect(measured).toEqual(ok({ known: 1, total: 3, unknownWords: 2, unresolved: 0 }));
  });

  it("reads a polyphone as its first reading unless the learner chose another", async () => {
    await db.knownMarks.add({ headword: "行", readingKey: "hang2", markedAt: 1 });
    const known = await loadKnownWords(db, "zh");
    if (!known.ok) throw new Error(known.error.kind);
    const body = "行。";
    expect(await measureText(reading, known.value, { body, readingChoices: {} })).toEqual(
      ok({ known: 0, total: 1, unknownWords: 1, unresolved: 0 }),
    );
    expect(
      await measureText(reading, known.value, { body, readingChoices: { 0: "hang2" } }),
    ).toEqual(ok({ known: 1, total: 1, unknownWords: 0, unresolved: 0 }));
  });

  it("sets apart the characters the dictionary lacks: they cannot be learned as words", async () => {
    const known = await loadKnownWords(db, "zh");
    if (!known.ok) throw new Error(known.error.kind);
    const measured = await measureText(reading, known.value, {
      body: "我们龘龘去",
      readingChoices: {},
    });
    expect(measured).toEqual(ok({ known: 0, total: 4, unknownWords: 3, unresolved: 1 }));
    expect(measured.ok && wordsToLearn(measured.value)).toBe(2);
  });

  it("is empty for a text with no Han word", async () => {
    const known = await loadKnownWords(db, "zh");
    if (!known.ok) throw new Error(known.error.kind);
    expect(
      await measureText(reading, known.value, { body: "Hello, 2026!", readingChoices: {} }),
    ).toEqual(ok({ known: 0, total: 0, unknownWords: 0, unresolved: 0 }));
  });
});

describe("describeCoverageFailure", () => {
  it("names what failed", () => {
    expect(describeCoverageFailure({ kind: "dataset-missing", dataset: "cc-cedict" })).toBe(
      "cc-cedict",
    );
    expect(describeCoverageFailure({ kind: "storage-failure", message: "quota" })).toBe("quota");
    expect(describeCoverageFailure({ kind: "invalid-reading", reading: "xx" })).toBe("xx");
    expect(describeCoverageFailure({ kind: "storage", message: "quota" })).toBe("quota");
  });
});
