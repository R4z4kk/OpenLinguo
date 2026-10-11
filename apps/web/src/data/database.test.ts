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

  it("stamps reviews made before the daily goal with its fallback", async () => {
    const legacy = new Dexie("goal-test");
    legacy.version(6).stores({ reviews: "id, cardId" });
    await legacy.table("reviews").add({ id: "r1", cardId: "c1" });
    legacy.close();

    const db = openDatabase("goal-test");
    expect(await db.reviews.toArray()).toEqual([{ id: "r1", cardId: "c1", dailyGoal: 20 }]);
    db.close();
  });
});
