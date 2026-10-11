import "fake-indexeddb/auto";
import { cardId, ok, type CardType, type WordKey } from "@openlinguo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database, type StoredEntry } from "./database.ts";
import { addWord, type LocalTime } from "./decks.ts";
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

const idOf = (word: WordKey, type: CardType): string => cardId({ language: "zh", ...word, type });

const session = async (now: LocalTime) => {
  const loaded = await loadSession(db, "hsk-2025", now, 20);
  if (!loaded.ok) throw new Error(loaded.error.kind);
  return loaded.value;
};

const ids = (items: readonly ReviewItem[]) =>
  items.map(({ cardId: id, new: isNew }) => [id, isNew]);

let db: Database;
let counter = 0;

beforeEach(async () => {
  counter += 1;
  db = openDatabase(`session-test-${String(counter)}`);
  await db.entries.bulkAdd([entry("你", "ni3", 1), entry("天", "tian1", 2)]);
});

describe("loadSession", () => {
  it("shows my words first, then band words, with their entries, and stores nothing", async () => {
    await addWord(db, TIAN);
    const { items, skipped } = await session(NOON);
    expect(ids(items)).toEqual([
      [idOf(TIAN, "recognition"), true],
      [idOf(NI, "recognition"), true],
    ]);
    expect(items[1]?.entry).toMatchObject({ headword: "你", reading: "ni3", level: 1 });
    expect(items[1]?.state.phase).toBe("new");
    expect(skipped).toBe(0);
    expect(await db.cards.count()).toBe(2);
  });

  it("skips a card whose word left the dictionary", async () => {
    await addWord(db, E);
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
    const again = await gradeItem(db, first, "good", NOON);
    expect(again).toMatchObject({ ok: true, value: { cardId: first.cardId, new: false } });
    expect(await db.cards.get(idOf(NI, "recall"))).toMatchObject({ personal: false, phase: "new" });
    if (!again.ok || again.value === null) throw new Error("not requeued");
    expect(again.value.state.phase).toBe("learning");
    expect(await gradeItem(db, again.value, "good", later(10))).toEqual(ok(null));
    expect(await db.reviews.count()).toBe(2);
  });

  it("keeps the word's other card for another day", async () => {
    const [first] = (await session(NOON)).items;
    if (first == null) throw new Error("empty session");
    await gradeItem(db, first, "again", NOON);
    expect(ids((await session(later(1))).items)).toEqual([
      [idOf(NI, "recognition"), false],
      [idOf(TIAN, "recognition"), true],
    ]);
  });

  it("returns a storage error and records nothing", async () => {
    const [first] = (await session(NOON)).items;
    if (first == null) throw new Error("empty session");
    vi.spyOn(db.reviews, "add").mockRejectedValueOnce(new Error("QuotaExceededError"));
    expect(await gradeItem(db, first, "good", NOON)).toEqual({
      ok: false,
      error: { kind: "storage", message: "Error: QuotaExceededError" },
    });
    expect(await db.reviews.count()).toBe(0);
  });
});
