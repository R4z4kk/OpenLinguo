import "fake-indexeddb/auto";
import {
  cardId,
  CURRENT_SCHEDULER,
  NEW_CARD_STATE,
  ok,
  replay,
  type CardType,
  type Phase,
  type NoteKey,
  type Review,
  type Subject,
  type WordKey,
} from "@openlinguo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deckWordId,
  MY_WORDS,
  openDatabase,
  type Database,
  type StoredCard,
  type StoredEntry,
} from "./database.ts";
import {
  createDeck,
  DECK_NAME_MAX,
  deckCounts,
  deleteDeck,
  fileWord,
  introduceWord,
  nextNewReadings,
  putCards,
  renameDeck,
  wordDecks,
  type DeckNameProblem,
  type LocalTime,
} from "./decks.ts";
import { recordReview } from "./review-log.ts";

const entry = (
  simplified: string,
  readingKey: string,
  hsk2025: number | null,
  gf0025: number | null,
  frequency: number | null,
): StoredEntry => ({
  id: `${simplified}\t${readingKey}`,
  simplified,
  reading: readingKey,
  variants: [],
  glosses: [[], [], []],
  hsk2025,
  gf0025,
  lexicon: true,
  frequency,
});

const HAO: WordKey = { headword: "好", readingKey: "hao3" };
const NI: WordKey = { headword: "你", readingKey: "ni3" };
const XING: WordKey = { headword: "行", readingKey: "xing2" };
const HANG: WordKey = { headword: "行", readingKey: "hang2" };
const E: WordKey = { headword: "鹅", readingKey: "e2" };
const TIAN: WordKey = { headword: "天", readingKey: "tian1" };

const ENTRIES = [
  entry("好", "hao3", 1, 1, 7),
  entry("你", "ni3", 1, 1, 7.5),
  entry("行", "xing2", 1, 2, 6),
  entry("行", "hang2", 3, null, 6),
  entry("鹅", "e2", null, 3, 4),
  entry("天", "tian1", 2, 1, 7),
];

const HOUR = 3_600_000;
// Paris summer: local noon on 2026-10-21.
const NOW: LocalTime = { at: Date.UTC(2026, 9, 21, 10), utcOffsetMinutes: 120 };
const NEXT_ROLLOVER = Date.UTC(2026, 9, 22, 2);

const idOf = (subject: Subject, type: CardType): string =>
  cardId({ language: "zh", ...subject, type });

const stored = (word: WordKey, type: CardType, phase: Phase, due: number | null): StoredCard => ({
  language: "zh",
  ...word,
  type,
  id: idOf(word, type),
  ...NEW_CARD_STATE,
  phase,
  due,
});

const review = (cardId: string, grade: Review["grade"]): Review => ({
  id: "00000000-0000-4000-8000-000000000001",
  cardId,
  grade,
  reviewedAt: NOW.at,
  utcOffsetMinutes: NOW.utcOffsetMinutes,
  scheduler: CURRENT_SCHEDULER,
  dailyGoal: 20,
});

let db: Database;
let counter = 0;

beforeEach(async () => {
  counter += 1;
  db = openDatabase(`decks-test-${String(counter)}`);
  await db.entries.bulkAdd(ENTRIES);
});

const file = (deckId: string, word: WordKey, filed = true) =>
  fileWord(db, deckId, word, filed, "hsk-2025");

const deckOf = async (name: string): Promise<string> => {
  const created = await createDeck(db, name);
  if (!created.ok) throw new Error(created.error.kind);
  return created.value.id;
};

const filedIn = async (word: WordKey): Promise<string[]> => {
  const result = await wordDecks(db, word);
  if (!result.ok) throw new Error(result.error.kind);
  return [...result.value.filed].sort();
};

const refused = (problem: DeckNameProblem) => ({
  ok: false,
  error: { kind: "deck-name", problem },
});

const unknown = (deckId: string) => ({ ok: false, error: { kind: "unknown-deck", deckId } });

/** Files a note with its cards and content, as the Anki import does. */
const fileNote = async (deckId: string, note: NoteKey): Promise<void> => {
  await db.deckWords.put({ ...note, id: deckWordId(deckId, note), deckId });
  await putCards(db, [note]);
  await db.notes.put({ id: note.note, characters: "字", pinyin: "", meaning: "m", updatedAt: 0 });
};

describe("named decks", () => {
  it("lists my words first, then the learner's decks by name", async () => {
    const zoo = await deckOf("  Zoo ");
    const animals = await deckOf("Animals");
    expect(await wordDecks(db, HAO)).toEqual(
      ok({
        decks: [
          { id: MY_WORDS, name: null },
          { id: animals, name: "Animals" },
          { id: zoo, name: "Zoo" },
        ],
        filed: new Set(),
      }),
    );
  });

  it("refuses an empty, too long or taken name", async () => {
    await deckOf("Zoo");
    expect(await createDeck(db, "  ")).toEqual(refused("empty"));
    expect(await createDeck(db, "x".repeat(DECK_NAME_MAX + 1))).toEqual(refused("too-long"));
    expect(await createDeck(db, " zoo")).toEqual(refused("taken"));
    expect(await createDeck(db, "x".repeat(DECK_NAME_MAX))).toMatchObject({ ok: true });
    expect(await createDeck(db, "Zöo")).toMatchObject({ ok: true });
    expect(await db.decks.count()).toBe(3);
  });

  it("renames a deck, to another case of its own name too", async () => {
    const zoo = await deckOf("Zoo");
    await deckOf("Farm");
    expect(await renameDeck(db, zoo, "farm")).toEqual(refused("taken"));
    expect(await renameDeck(db, zoo, "zoo ")).toEqual(ok({ id: zoo, name: "zoo" }));
    expect(await db.decks.get(zoo)).toEqual({ id: zoo, name: "zoo" });
    expect(await renameDeck(db, MY_WORDS, "Mine")).toEqual(unknown(MY_WORDS));
  });
});

describe("fileWord", () => {
  it("stores the two cards of a reading once, whatever the number of decks", async () => {
    const zoo = await deckOf("Zoo");
    expect(await file(MY_WORDS, HAO)).toEqual(ok(null));
    expect(await file(zoo, HAO)).toEqual(ok(null));
    expect(await db.cards.toArray()).toEqual(
      expect.arrayContaining([
        stored(HAO, "recognition", "new", null),
        stored(HAO, "recall", "new", null),
      ]),
    );
    expect(await db.cards.count()).toBe(2);
    expect(await filedIn(HAO)).toEqual([MY_WORDS, zoo].sort());
    expect(await filedIn(NI)).toEqual([]);
  });

  it("takes an ungraded reading out of the queue with its last deck, keeping its reviews", async () => {
    const zoo = await deckOf("Zoo");
    await file(MY_WORDS, E);
    await file(zoo, E);
    const first = review(idOf(E, "recognition"), "good");
    await recordReview(db, first);
    expect(await file(MY_WORDS, E, false)).toEqual(ok(null));
    expect(await db.cards.count()).toBe(2);
    expect(await file(zoo, E, false)).toEqual(ok(null));
    expect(await db.cards.count()).toBe(0);
    expect(await db.reviews.toArray()).toEqual([first]);
    expect(await filedIn(E)).toEqual([]);

    await file(zoo, E);
    const state = replay(first.cardId, [first]);
    if (!state.ok) throw new Error(state.error.kind);
    expect(await db.cards.get(first.cardId)).toMatchObject(state.value);
  });

  it("keeps the cards of a reading graded in the referential", async () => {
    await file(MY_WORDS, NI);
    await recordReview(db, review(idOf(NI, "recognition"), "good"));
    const reviewed = await db.cards.get(idOf(NI, "recognition"));
    await file(MY_WORDS, NI, false);
    expect(await db.cards.get(idOf(NI, "recognition"))).toEqual(reviewed);
    expect(await filedIn(NI)).toEqual([]);

    await file(MY_WORDS, HANG);
    expect(await fileWord(db, MY_WORDS, HANG, false, "gf0025-2021")).toEqual(ok(null));
    expect(await db.cards.get(idOf(HANG, "recall"))).toBeUndefined();
  });

  it("files an introduced band word without changing its progress", async () => {
    expect(await introduceWord(db, NI)).toEqual(ok(null));
    expect(await db.cards.get(idOf(NI, "recall"))).toEqual(stored(NI, "recall", "new", null));
    expect(await db.deckWords.count()).toBe(0);
    await recordReview(db, review(idOf(NI, "recognition"), "good"));
    const reviewed = await db.cards.get(idOf(NI, "recognition"));
    await file(MY_WORDS, NI);
    await introduceWord(db, NI);
    expect(await db.cards.get(idOf(NI, "recognition"))).toEqual(reviewed);
    expect(await filedIn(NI)).toEqual([MY_WORDS]);
  });

  it("refuses an unknown deck", async () => {
    expect(await file("gone", HAO)).toEqual(unknown("gone"));
    expect(await db.cards.count()).toBe(0);
  });

  it("writes nothing when the log cannot be replayed or the cards cannot be stored", async () => {
    await db
      .table("reviews")
      .add({ ...review(idOf(HAO, "recall"), "good"), scheduler: "fsrs7-v1" });
    expect(await file(MY_WORDS, HAO)).toMatchObject({
      ok: false,
      error: { kind: "scheduler-failure" },
    });
    vi.spyOn(db.cards, "bulkPut").mockRejectedValueOnce(new Error("QuotaExceededError"));
    expect(await file(MY_WORDS, NI)).toEqual({
      ok: false,
      error: { kind: "storage", message: "Error: QuotaExceededError" },
    });
    expect(await db.cards.count()).toBe(0);
    expect(await db.deckWords.count()).toBe(0);
  });
});

describe("deleteDeck", () => {
  it("takes out of the queue the words in no other deck and in no band", async () => {
    const zoo = await deckOf("Zoo");
    await file(zoo, E);
    await file(zoo, HAO);
    await file(MY_WORDS, HAO);
    await file(zoo, NI);
    await recordReview(db, review(idOf(E, "recall"), "good"));
    expect(await deleteDeck(db, zoo, "hsk-2025")).toEqual(ok(null));
    expect(await db.decks.count()).toBe(0);
    expect(await db.deckWords.toArray()).toEqual([
      expect.objectContaining({ deckId: MY_WORDS, ...HAO }),
    ]);
    expect(await db.cards.count()).toBe(4);
    expect(await db.cards.get(idOf(E, "recall"))).toBeUndefined();
    expect(await db.reviews.count()).toBe(1);
  });

  it("deletes the notes in no other deck with their content and cards, keeping their reviews", async () => {
    const zoo = await deckOf("Zoo");
    const farm = await deckOf("Farm");
    const kept = { note: "kept" };
    const gone = { note: "gone" };
    await fileNote(zoo, kept);
    await fileNote(farm, kept);
    await fileNote(zoo, gone);
    await recordReview(db, review(idOf(gone, "recall"), "good"));
    expect(await deleteDeck(db, zoo, "hsk-2025")).toEqual(ok(null));
    expect((await db.notes.toArray()).map((note) => note.id)).toEqual(["kept"]);
    expect((await db.cards.toArray()).map((card) => card.id).sort()).toEqual(
      [idOf(kept, "recall"), idOf(kept, "recognition")].sort(),
    );
    expect(await db.reviews.count()).toBe(1);
  });

  it("cannot delete my words", async () => {
    await file(MY_WORDS, E);
    expect(await deleteDeck(db, MY_WORDS, "hsk-2025")).toEqual(unknown(MY_WORDS));
    expect(await filedIn(E)).toEqual([MY_WORDS]);
  });
});

describe("deckCounts", () => {
  it("counts each graded reading of a band as new cards", async () => {
    const empty = { new: 0, learning: 0, due: 0 };
    expect(await deckCounts(db, "hsk-2025", NOW)).toEqual(
      ok({
        personal: [{ id: MY_WORDS, name: null, counts: empty, leaving: 0 }],
        bands: [
          { ...empty, new: 6 },
          { ...empty, new: 2 },
          { ...empty, new: 2 },
          empty,
          empty,
          empty,
          empty,
        ],
      }),
    );
  });

  it("counts started cards due before the next 4:00 rollover, and the words a deletion drops", async () => {
    await db.cards.bulkAdd([
      stored(HAO, "recognition", "review", NEXT_ROLLOVER - 1),
      stored(HAO, "recall", "new", null),
      stored(E, "recognition", "learning", NOW.at + HOUR / 6),
      stored(E, "recall", "review", NEXT_ROLLOVER),
      stored(NI, "recognition", "relearning", NOW.at - HOUR),
      stored(NI, "recall", "new", null),
    ]);
    const animals = await deckOf("Animals");
    await file(MY_WORDS, HAO);
    await file(MY_WORDS, E);
    await file(animals, E);
    await file(animals, HANG);
    expect(await deckCounts(db, "gf0025-2021", NOW)).toMatchObject({
      ok: true,
      value: {
        personal: [
          { id: MY_WORDS, name: null, counts: { new: 1, learning: 1, due: 1 }, leaving: 0 },
          { id: animals, name: "Animals", counts: { new: 2, learning: 1, due: 0 }, leaving: 1 },
        ],
        bands: [
          { new: 4, learning: 1, due: 1 },
          { new: 2, learning: 0, due: 0 },
          { new: 0, learning: 1, due: 0 },
          ...Array.from({ length: 4 }, () => ({ new: 0, learning: 0, due: 0 })),
        ],
      },
    });
    expect(await deckCounts(db, "hsk-2025", NOW)).toMatchObject({
      ok: true,
      value: { personal: [{ leaving: 0 }, { leaving: 0 }] },
    });
  });
});

describe("deckCounts of notes", () => {
  it("counts the cards of a deck's notes, and the notes a deletion drops", async () => {
    const zoo = await deckOf("Zoo");
    await fileNote(zoo, { note: "n" });
    const counts = await deckCounts(db, "hsk-2025", NOW);
    expect(counts.ok && counts.value.bands.map((band) => band.new)).toEqual([6, 2, 2, 0, 0, 0, 0]);
    expect(counts).toMatchObject({
      ok: true,
      value: {
        personal: [
          { id: MY_WORDS },
          { id: zoo, counts: { new: 2, learning: 0, due: 0 }, leaving: 1 },
        ],
      },
    });
  });
});

describe("nextNewReadings", () => {
  beforeEach(async () => {
    const zoo = await deckOf("Zoo");
    await file(MY_WORDS, E);
    await file(MY_WORDS, HANG);
    await file(zoo, HANG);
    await db.cards.bulkAdd([
      stored(TIAN, "recognition", "review", NOW.at),
      stored(TIAN, "recall", "new", null),
    ]);
    await file(zoo, TIAN);
  });

  it("puts the words of every personal deck first, then the bands by level and frequency", async () => {
    expect(await nextNewReadings(db, "hsk-2025", 10)).toEqual(ok([HANG, E, NI, HAO, XING]));
  });

  it("puts notes after the personal words with a level or a frequency", async () => {
    const note = { note: "n" };
    await fileNote(MY_WORDS, note);
    expect(await nextNewReadings(db, "hsk-2025", 10)).toEqual(ok([HANG, E, note, NI, HAO, XING]));
  });

  it("stops at the limit", async () => {
    expect(await nextNewReadings(db, "hsk-2025", 3)).toEqual(ok([HANG, E, NI]));
  });

  it("orders by the chosen referential", async () => {
    expect(await nextNewReadings(db, "gf0025-2021", 10)).toEqual(ok([E, HANG, NI, HAO, XING]));
  });
});
