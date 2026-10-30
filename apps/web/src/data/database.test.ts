import "fake-indexeddb/auto";
import { cardId, NEW_CARD_STATE, type CardKey, type CardType } from "@openlinguo/core";
import { Dexie } from "dexie";
import { describe, expect, it } from "vitest";
import { MY_WORDS, openDatabase } from "./database.ts";

describe("openDatabase", () => {
  it("imports the data again when upgrading a database without search keys", async () => {
    const legacy = new Dexie("upgrade-test");
    legacy.version(1).stores({
      entries: "id, simplified, *variants",
      characters: "character",
      meta: "key",
      imports: "sha256",
    });
    await legacy.table("meta").bulkPut([
      { key: "dataVersion", value: "v1" },
      { key: "importingVersion", value: "v1" },
      { key: "lexicon", value: ["电话"] },
    ]);
    legacy.close();

    const db = openDatabase("upgrade-test");
    expect(await db.meta.toArray()).toEqual([{ key: "lexicon", value: ["电话"] }]);
    db.close();
  });

  it("files personal cards in my words", async () => {
    const legacy = new Dexie("personal-test");
    legacy.version(5).stores({ cards: "id, due", reviews: "id, cardId" });
    const card = (headword: string, type: CardType, personal: boolean) => {
      const key: CardKey = { language: "zh", headword, readingKey: "hao3", type };
      return { ...key, id: cardId(key), ...NEW_CARD_STATE, personal };
    };
    await legacy
      .table("cards")
      .bulkAdd([
        card("好", "recognition", true),
        card("好", "recall", true),
        card("号", "recall", false),
      ]);
    legacy.close();

    const db = openDatabase("personal-test");
    expect(await db.deckWords.toArray()).toEqual([
      { id: `${MY_WORDS}\t好\thao3`, deckId: MY_WORDS, headword: "好", readingKey: "hao3" },
    ]);
    expect((await db.cards.toArray()).filter((stored) => "personal" in stored)).toEqual([]);
    expect(await db.cards.count()).toBe(3);
    db.close();
  });

  it("stamps reviews made before the daily goal with its fallback, before words with null", async () => {
    const legacy = new Dexie("goal-test");
    legacy.version(6).stores({ reviews: "id, cardId" });
    await legacy.table("reviews").add({ id: "r1", cardId: "c1" });
    legacy.close();

    const db = openDatabase("goal-test");
    expect(await db.reviews.toArray()).toEqual([
      { id: "r1", cardId: "c1", dailyGoal: 20, wordDone: null },
    ]);
    db.close();
  });

  it("marks pack contours stored before their version as of unknown version", async () => {
    const legacy = new Dexie("contour-version-test");
    legacy.version(12).stores({ wordAudio: "id, *bands", audioBands: "id" });
    await legacy
      .table("wordAudio")
      .add({ id: "一\tyi1", type: "audio/mpeg", f0: [1, 2], bands: ["hsk-2025:1"] });
    legacy.close();

    const db = openDatabase("contour-version-test");
    expect(await db.wordAudio.get("一\tyi1")).toEqual({
      id: "一\tyi1",
      type: "audio/mpeg",
      f0: [1, 2],
      f0Version: null,
      bands: ["hsk-2025:1"],
    });
    db.close();
  });

  it("marks notes stored before M5 as not from an AI", async () => {
    const legacy = new Dexie("note-provenance-test");
    legacy.version(14).stores({ notes: "id" });
    const note = { id: "n1", characters: "字", pinyin: "zì", meaning: "m", updatedAt: 0 };
    await legacy.table("notes").add(note);
    legacy.close();

    const db = openDatabase("note-provenance-test");
    expect(await db.notes.get("n1")).toEqual({ ...note, provenance: null });
    expect(await db.aiNotice.count()).toBe(0);
    db.close();
  });

  it("gives challenges saved before corrections none", async () => {
    const legacy = new Dexie("challenge-corrections-test");
    legacy.version(17).stores({ challenges: "day" });
    const challenge = {
      day: "2026-10-19",
      headword: "电话",
      readingKey: "dian4 hua4",
      sentences: ["我打电话。", "", "", "", ""],
      updatedAt: 0,
    };
    await legacy.table("challenges").add(challenge);
    legacy.close();

    const db = openDatabase("challenge-corrections-test");
    expect(await db.challenges.get("2026-10-19")).toEqual({
      ...challenge,
      corrections: [null, null, null, null, null],
    });
    db.close();
  });

  it("shows the one AI notice to learners who saw a per-feature one", async () => {
    const legacy = new Dexie("ai-notice-migration-test");
    legacy.version(20).stores({ aiNotices: "feature" });
    await legacy.table("aiNotices").add({ feature: "journal" });
    legacy.close();

    const db = openDatabase("ai-notice-migration-test");
    expect(await db.aiNotice.count()).toBe(0);
    expect(db.tables.map(({ name }) => name)).not.toContain("aiNotices");
    db.close();
  });

  it("adds the texts and the known marks to a database of version 22, keeping its data", async () => {
    const legacy = new Dexie("texts-migration-test");
    legacy.version(22).stores({ journal: "day" });
    const entry = { day: "2026-10-19", text: "我打电话。", corrections: [], updatedAt: 0 };
    await legacy.table("journal").add(entry);
    legacy.close();

    const db = openDatabase("texts-migration-test");
    expect(await db.journal.toArray()).toEqual([entry]);
    expect(await db.texts.count()).toBe(0);
    expect(await db.knownMarks.count()).toBe(0);
    await db.knownMarks.bulkAdd([
      { headword: "行", readingKey: "xing2", markedAt: 1 },
      { headword: "行", readingKey: "hang2", markedAt: 2 },
    ]);
    expect(await db.knownMarks.get(["行", "hang2"])).toEqual({
      headword: "行",
      readingKey: "hang2",
      markedAt: 2,
    });
    db.close();
  });

  it("adds the lexicon and the kept answers to a database of version 23, keeping its data", async () => {
    const legacy = new Dexie("lexicon-migration-test");
    legacy.version(23).stores({ knownMarks: "[headword+readingKey]" });
    const mark = { headword: "行", readingKey: "xing2", markedAt: 1 };
    await legacy.table("knownMarks").add(mark);
    legacy.close();

    const db = openDatabase("lexicon-migration-test");
    expect(await db.knownMarks.toArray()).toEqual([mark]);
    expect(await db.lexicon.count()).toBe(0);
    const found = {
      kind: "person",
      reading: null,
      gloss: null,
      reference: null,
      provenance: null,
    } as const;
    await db.resolutions.bulkAdd([
      { sequence: "王小红", source: "wikidata", found: [found], checkedAt: 1 },
      { sequence: "王小红", source: "ai", found: [], checkedAt: 2 },
    ]);
    expect((await db.resolutions.where("sequence").equals("王小红").toArray()).length).toBe(2);
    expect(await db.resolutions.get(["王小红", "ai"])).toMatchObject({ checkedAt: 2 });
    db.close();
  });
});
