import "fake-indexeddb/auto";
import {
  cardId,
  NEW_CARD_STATE,
  newCards,
  ok,
  type CardState,
  type CardType,
  type Subject,
  type WordKey,
} from "@openlinguo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wordAudioId } from "./audio-packs.ts";
import {
  deckWordId,
  MY_WORDS,
  openDatabase,
  type Database,
  type StoredEntry,
  type StoredStrokes,
} from "./database.ts";
import { fileWord, putCards, type LocalTime } from "./decks.ts";
import { todayActivity } from "./daily-goal.ts";
import type { Practice } from "./practice.ts";
import { gradeItem, loadSession, type ReviewItem } from "./session.ts";

const entry = (simplified: string, readingKey: string, hsk2025: number): StoredEntry => ({
  id: `${simplified}\t${readingKey}`,
  simplified,
  reading: readingKey,
  variants: [],
  glosses: [[`${simplified} gloss`], [], []],
  hsk2025,
  gf0025: null,
  lexicon: true,
  frequency: 7,
});

const NI: WordKey = { headword: "你", readingKey: "ni3" };
const TIAN: WordKey = { headword: "天", readingKey: "tian1" };
const E: WordKey = { headword: "鹅", readingKey: "e2" };
const MINUTE = 60_000;
// Paris summer, 12:00 on 2026-10-21.
const NOON: LocalTime = { at: Date.UTC(2026, 9, 21, 10), utcOffsetMinutes: 120 };
const later = (minutes: number): LocalTime => ({ ...NOON, at: NOON.at + minutes * MINUTE });

const idOf = (subject: Subject, type: CardType): string =>
  cardId({ language: "zh", ...subject, type });

const NO_PRACTICE: Practice = { writing: false, typing: false };

const session = async (now: LocalTime, practice = NO_PRACTICE) => {
  const loaded = await loadSession(db, "hsk-2025", now, 20, practice);
  if (!loaded.ok) throw new Error(loaded.error.kind);
  return loaded.value;
};

const ids = (items: readonly ReviewItem[]) =>
  items.map(({ cardId: id, new: isNew }) => [id, isNew]);

const stampedGoals = async () =>
  (await db.reviews.toArray())
    .sort((a, b) => a.reviewedAt - b.reviewedAt)
    .map(({ dailyGoal }) => dailyGoal);

let db: Database;
let counter = 0;

beforeEach(async () => {
  counter += 1;
  db = openDatabase(`session-test-${String(counter)}`);
  await db.entries.bulkAdd([entry("你", "ni3", 1), entry("天", "tian1", 2)]);
});

describe("loadSession", () => {
  it("shows my words first, then band words, with their entries, and stores nothing", async () => {
    await fileWord(db, MY_WORDS, TIAN, true, "hsk-2025");
    const { items, skipped } = await session(NOON);
    expect(ids(items)).toEqual([
      [idOf(TIAN, "recognition"), true],
      [idOf(NI, "recognition"), true],
    ]);
    expect(items[1]).toMatchObject({ entry: { headword: "你", reading: "ni3", level: 1 } });
    expect(items[1]?.state.phase).toBe("new");
    expect(skipped).toBe(0);
    expect(await db.cards.count()).toBe(2);
  });

  it("adds a word's AI French glosses, marked by their source", async () => {
    await db.aiGlosses.add({
      id: "你\tni3",
      ...NI,
      senses: [{ english: "你 gloss", french: "toi" }],
      provenance: {
        origin: "ai",
        provider: "local",
        model: "qwen3:30b-a3b",
        promptVersion: "zh-gloss-fr-v1",
        createdAt: "2026-10-19T15:20:00.000Z",
      },
    });
    const { items } = await session(NOON);
    expect(items[0]).toMatchObject({
      headword: "你",
      entry: {
        glosses: [
          { lang: "en", text: "你 gloss", source: "cc-cedict" },
          { lang: "fr", text: "toi", source: "ai" },
        ],
      },
    });
  });

  it("gives the audio a deck holds for the reading", async () => {
    await fileWord(db, MY_WORDS, TIAN, true, "hsk-2025");
    const id = deckWordId(MY_WORDS, TIAN);
    await db.audio.add({ id, type: "audio/wav", data: new ArrayBuffer(4) });
    const { items } = await session(NOON);
    expect(items.map((item) => ["note" in item ? item.note : item.headword, item.audio])).toEqual([
      ["天", { table: "audio", id }],
      ["你", null],
    ]);
  });

  it("falls back to the audio pack's recording, after a deck's own audio", async () => {
    await fileWord(db, MY_WORDS, TIAN, true, "hsk-2025");
    const id = deckWordId(MY_WORDS, TIAN);
    await db.audio.add({ id, type: "audio/wav", data: new ArrayBuffer(4) });
    const packed = (headword: string, readingKey: string) => ({
      id: wordAudioId(headword, readingKey),
      type: "audio/mpeg",
      data: new ArrayBuffer(4),
      f0: null,
      f0Version: null,
      bands: ["hsk-2025:1"],
    });
    await db.wordAudio.bulkAdd([packed("天", TIAN.readingKey), packed("你", NI.readingKey)]);
    const { items } = await session(NOON);
    expect(items.map((item) => item.audio)).toEqual([
      { table: "audio", id },
      { table: "wordAudio", id: wordAudioId("你", NI.readingKey) },
    ]);
  });

  it("shows notes after my words with their content and audio, and grades them", async () => {
    const note = { note: "Fx4k]?Lb!e" };
    const lost = { note: "lost" };
    await fileWord(db, MY_WORDS, TIAN, true, "hsk-2025");
    for (const subject of [note, lost])
      await db.deckWords.add({ ...subject, id: deckWordId(MY_WORDS, subject), deckId: MY_WORDS });
    await putCards(db, [note, lost]);
    const content = { characters: "不存在", pinyin: "bù cún zài", meaning: "made up" };
    await db.notes.add({ ...content, id: note.note, updatedAt: 0, provenance: null });
    const audio = deckWordId(MY_WORDS, note);
    await db.audio.add({ id: audio, type: "audio/mpeg", data: new ArrayBuffer(4) });

    const { items, skipped } = await session(NOON);
    expect(ids(items)).toEqual([
      [idOf(TIAN, "recognition"), true],
      [idOf(note, "recognition"), true],
      [idOf(NI, "recognition"), true],
    ]);
    expect(skipped).toBe(1);
    const [, shown] = items;
    expect(shown).toMatchObject({
      ...note,
      content,
      audio: { table: "audio", id: audio },
      state: { phase: "new" },
    });
    if (shown == null) throw new Error("no note");
    expect(await gradeItem(db, shown, "easy", NOON, 20, false)).toEqual(ok(null));
    expect(await db.cards.get(idOf(note, "recognition"))).toMatchObject({ phase: "review" });
  });

  it("skips a card whose word left the dictionary", async () => {
    await fileWord(db, MY_WORDS, E, true, "hsk-2025");
    const { items, skipped } = await session(NOON);
    expect(ids(items)).toEqual([
      [idOf(NI, "recognition"), true],
      [idOf(TIAN, "recognition"), true],
    ]);
    expect(skipped).toBe(1);
  });
});

describe("tone cards", () => {
  const recording = (word: WordKey) => ({
    id: wordAudioId(word.headword, word.readingKey),
    type: "audio/mpeg",
    data: new ArrayBuffer(4),
    f0: null,
    f0Version: null,
    bands: ["hsk-2025:1"],
  });
  const started = (due: number): Partial<CardState> => ({
    phase: "review",
    due,
    firstReviewDay: "2026-10-15",
    lastReviewDay: "2026-10-15",
  });
  const startCards = async (word: WordKey, types: readonly CardType[], due: number) => {
    await db.cards.bulkPut(
      newCards("zh", word, types).map((card) => ({ ...card, ...NEW_CARD_STATE, ...started(due) })),
    );
  };

  it("offers a new tone card for a started reading with a recording, and stores it when graded", async () => {
    await fileWord(db, MY_WORDS, TIAN, true, "hsk-2025");
    await startCards(TIAN, ["recognition", "recall"], NOON.at + 5 * 24 * 60 * MINUTE);
    await db.wordAudio.add(recording(TIAN));
    const { items, toneHeldBack } = await session(NOON);
    expect(ids(items)).toEqual([
      [idOf(TIAN, "tone"), true],
      [idOf(NI, "recognition"), true],
    ]);
    expect(items[0]?.audio).toEqual({ table: "wordAudio", id: wordAudioId("天", "tian1") });
    expect(toneHeldBack).toBe(0);
    expect(await db.cards.get(idOf(TIAN, "tone"))).toBeUndefined();
    const [tone] = items;
    if (tone == null) throw new Error("no tone card");
    await gradeItem(db, tone, "good", NOON, 20, false);
    expect(await db.cards.get(idOf(TIAN, "tone"))).toMatchObject({
      type: "tone",
      phase: "learning",
    });
    expect(await db.reviews.toArray()).toMatchObject([{ cardId: idOf(TIAN, "tone") }]);
  });

  it("plays the pack's recording, never a deck's own audio", async () => {
    await fileWord(db, MY_WORDS, TIAN, true, "hsk-2025");
    await db.audio.add({
      id: deckWordId(MY_WORDS, TIAN),
      type: "audio/wav",
      data: new ArrayBuffer(4),
    });
    await startCards(TIAN, ["recognition", "recall"], NOON.at + 5 * 24 * 60 * MINUTE);
    await db.wordAudio.add(recording(TIAN));
    const { items } = await session(NOON);
    expect(items[0]).toMatchObject({
      type: "tone",
      audio: { table: "wordAudio", id: wordAudioId("天", "tian1") },
    });
  });

  it("offers none without the recording, and counts a due tone card it holds back", async () => {
    await fileWord(db, MY_WORDS, TIAN, true, "hsk-2025");
    await startCards(TIAN, ["recognition", "recall", "tone"], NOON.at - 60 * MINUTE);
    const { items, toneHeldBack } = await session(NOON);
    expect(ids(items)).toEqual([
      [idOf(TIAN, "recall"), false],
      [idOf(NI, "recognition"), true],
    ]);
    expect(toneHeldBack).toBe(1);
    await db.cards.update(idOf(TIAN, "tone"), { due: NOON.at - 2 * 60 * MINUTE });
    await db.wordAudio.add(recording(TIAN));
    const served = await session(NOON);
    expect(served.toneHeldBack).toBe(0);
    expect(ids(served.items)[0]).toEqual([idOf(TIAN, "tone"), false]);
  });

  it("offers none for a reading with no tone to hear", async () => {
    const neutral: WordKey = { headword: "吗", readingKey: "ma5" };
    await db.entries.add(entry("吗", "ma5", 1));
    await startCards(neutral, ["recognition", "recall"], NOON.at + 5 * 24 * 60 * MINUTE);
    await db.wordAudio.add(recording(neutral));
    const { items } = await session(NOON);
    expect(items.some((item) => item.type === "tone")).toBe(false);
  });
});

describe("writing and typing cards", () => {
  const FUTURE = NOON.at + 5 * 24 * 60 * MINUTE;
  const strokes = (character: string): StoredStrokes => ({
    character,
    strokes: ["M 0 0 Z"],
    medians: [[[0, 0]]],
  });
  const start = async (word: WordKey, types: readonly CardType[], due: number) => {
    await db.cards.bulkPut(
      newCards("zh", word, types).map((card) => ({
        ...card,
        ...NEW_CARD_STATE,
        phase: "review" as const,
        due,
        firstReviewDay: "2026-10-15",
        lastReviewDay: "2026-10-15",
      })),
    );
  };

  it("offers writing when every character has strokes, typing for any started word, as set", async () => {
    await start(TIAN, ["recognition", "recall"], FUTURE);
    await start(NI, ["recognition", "recall"], FUTURE);
    await db.strokes.add(strokes("天"));
    expect(ids((await session(NOON, { writing: true, typing: false })).items)).toEqual([
      [idOf(TIAN, "writing"), true],
    ]);
    expect(ids((await session(NOON, { writing: true, typing: true })).items)).toEqual([
      [idOf(NI, "typing"), true],
      [idOf(TIAN, "typing"), true],
    ]);
    expect(ids((await session(NOON)).items)).toEqual([]);
  });

  it("stores only the graded card", async () => {
    await start(TIAN, ["recognition", "recall"], FUTURE);
    await db.strokes.add(strokes("天"));
    const [first] = (await session(NOON, { writing: true, typing: true })).items;
    if (first == null) throw new Error("empty session");
    expect(first.type).toBe("typing");
    await gradeItem(db, first, "good", NOON, 20, false);
    expect(await db.cards.get(idOf(TIAN, "typing"))).toMatchObject({ phase: "learning" });
    expect(await db.cards.get(idOf(TIAN, "writing"))).toBeUndefined();
  });

  it("skips and counts a due writing card whose word lost its strokes, unless writing is off", async () => {
    await start(TIAN, ["recognition", "recall"], FUTURE);
    await start(TIAN, ["writing"], NOON.at - 60 * MINUTE);
    const lost = await session(NOON, { writing: true, typing: false });
    expect(ids(lost.items)).toEqual([[idOf(NI, "recognition"), true]]);
    expect(lost.skipped).toBe(1);
    expect((await session(NOON)).skipped).toBe(0);
    await db.strokes.add(strokes("天"));
    const back = await session(NOON, { writing: true, typing: false });
    expect(ids(back.items)).toEqual([
      [idOf(TIAN, "writing"), false],
      [idOf(NI, "recognition"), true],
    ]);
    expect(back.skipped).toBe(0);
  });
});

describe("gradeItem", () => {
  it("stores a band word's cards, then brings the card back while it is learning", async () => {
    const [first] = (await session(NOON)).items;
    if (first == null) throw new Error("empty session");
    const again = await gradeItem(db, first, "good", NOON, 50, false);
    expect(again).toMatchObject({ ok: true, value: { cardId: first.cardId, new: false } });
    expect(await db.reviews.toArray()).toMatchObject([{ cardId: first.cardId, dailyGoal: 50 }]);
    expect(await db.cards.get(idOf(NI, "recall"))).toMatchObject({ phase: "new" });
    expect(await db.deckWords.count()).toBe(0);
    if (!again.ok || again.value === null) throw new Error("not requeued");
    expect(again.value.state.phase).toBe("learning");
    expect(await gradeItem(db, again.value, "good", later(10), 20, false)).toEqual(ok(null));
    expect(await stampedGoals()).toEqual([50, 20]);
  });

  it("caps the stamped goal at the day's count once the grade empties the session", async () => {
    const [first] = (await session(NOON)).items;
    if (first == null) throw new Error("empty session");
    const again = await gradeItem(db, first, "good", NOON, 20, true);
    if (!again.ok || again.value === null) throw new Error("not requeued");
    expect(await gradeItem(db, again.value, "good", later(10), 20, true)).toEqual(ok(null));
    expect(await stampedGoals()).toEqual([20, 2]);
    expect(await todayActivity(db, later(10))).toEqual(ok({ reviews: 2, goalMet: true }));
  });

  it("keeps the word's other card for another day", async () => {
    const [first] = (await session(NOON)).items;
    if (first == null) throw new Error("empty session");
    await gradeItem(db, first, "again", NOON, 20, false);
    expect(ids((await session(later(1))).items)).toEqual([
      [idOf(NI, "recognition"), false],
      [idOf(TIAN, "recognition"), true],
    ]);
  });

  it("returns a storage error and records nothing", async () => {
    const [first] = (await session(NOON)).items;
    if (first == null) throw new Error("empty session");
    vi.spyOn(db.reviews, "add").mockRejectedValueOnce(new Error("QuotaExceededError"));
    expect(await gradeItem(db, first, "good", NOON, 20, false)).toEqual({
      ok: false,
      error: { kind: "storage", message: "Error: QuotaExceededError" },
    });
    expect(await db.reviews.count()).toBe(0);
  });
});
