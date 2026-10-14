import "fake-indexeddb/auto";
import { cardId, ok, type CardType, type Subject, type WordKey } from "@openlinguo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wordAudioId } from "./audio-packs.ts";
import { deckWordId, MY_WORDS, openDatabase, type Database, type StoredEntry } from "./database.ts";
import { fileWord, putCards, type LocalTime } from "./decks.ts";
import { todayActivity } from "./daily-goal.ts";
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

const session = async (now: LocalTime) => {
  const loaded = await loadSession(db, "hsk-2025", now, 20);
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
    await db.notes.add({ ...content, id: note.note, updatedAt: 0 });
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
