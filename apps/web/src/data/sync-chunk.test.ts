import { cardId, CURRENT_SCHEDULER, type CardKey, type Review } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { deckWordId, MY_WORDS } from "./database.ts";
import {
  decodeChunk,
  encodeChunk,
  SYNC_FORMAT,
  SYNC_VERSION,
  type SyncChunk,
} from "./sync-chunk.ts";

const DECK = "00000000-0000-4000-8000-00000000000a";
const WORD = { headword: "好", readingKey: "hao3" };
const CARD_KEY: CardKey = { language: "zh", ...WORD, type: "recall" };
const CARD = { ...CARD_KEY, id: cardId(CARD_KEY) };
const NOTE = {
  id: "note-1",
  characters: "你好",
  pinyin: "nǐ hǎo",
  meaning: "hello",
  updatedAt: 42,
  provenance: null,
};
const REVIEW: Review = {
  id: "00000000-0000-4000-8000-000000000001",
  cardId: CARD.id,
  grade: "good",
  reviewedAt: Date.UTC(2026, 10, 3, 6),
  utcOffsetMinutes: 60,
  scheduler: CURRENT_SCHEDULER,
  dailyGoal: 20,
  wordDone: null,
};
const change = { changedAt: 5, deleted: false };

const CHUNK: SyncChunk = {
  format: SYNC_FORMAT,
  version: SYNC_VERSION,
  reviews: [REVIEW],
  entities: [
    { ...change, table: "cards", key: CARD.id, value: CARD },
    { ...change, table: "decks", key: DECK, value: { id: DECK, name: "Voyage" } },
    {
      ...change,
      table: "deckWords",
      key: deckWordId(DECK, WORD),
      value: { deckId: DECK, ...WORD },
    },
    {
      ...change,
      table: "deckWords",
      key: deckWordId(MY_WORDS, { note: "note-1" }),
      value: { deckId: MY_WORDS, note: "note-1" },
    },
    { ...change, table: "notes", key: NOTE.id, value: NOTE },
    {
      ...change,
      table: "knownMarks",
      key: JSON.stringify(["好", "hao3"]),
      value: { ...WORD, markedAt: 7 },
    },
    { changedAt: 6, deleted: true, table: "decks", key: DECK, value: null },
  ],
};

const gzip = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(
    await new Response(
      new Response(text).body?.pipeThrough(new CompressionStream("gzip")) ?? null,
    ).arrayBuffer(),
  );

const decodeJson = async (json: unknown) => decodeChunk(await gzip(JSON.stringify(json)));

const withEntity = (entity: unknown) => ({ ...CHUNK, entities: [entity] });

describe("encodeChunk and decodeChunk", () => {
  it("decodes what it encodes", async () => {
    expect(await decodeChunk(await encodeChunk(CHUNK))).toEqual({ ok: true, value: CHUNK });
  });

  it("gzips", async () => {
    const bytes = await encodeChunk(CHUNK);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  });

  it("a corrupted chunk is unreadable", async () => {
    const bytes = await encodeChunk(CHUNK);
    const flipped = bytes.slice();
    flipped[Math.floor(flipped.length / 2)] = (flipped[Math.floor(flipped.length / 2)] ?? 0) ^ 0xff;
    for (const broken of [flipped, bytes.slice(0, 12), new Uint8Array([1, 2, 3]), new Uint8Array()])
      expect(await decodeChunk(broken)).toEqual({ ok: false, error: { kind: "unreadable" } });
  });

  it("text that is not JSON is unreadable", async () => {
    expect(await decodeChunk(await gzip("not json"))).toEqual({
      ok: false,
      error: { kind: "unreadable" },
    });
  });

  it("a higher version is newer-format", async () => {
    expect(
      await decodeJson({ format: SYNC_FORMAT, version: SYNC_VERSION + 1, shape: "new" }),
    ).toEqual({ ok: false, error: { kind: "newer-format", version: SYNC_VERSION + 1 } });
  });

  it("another format is unreadable, whatever its version", async () => {
    expect(await decodeJson({ ...CHUNK, format: "other", version: 99 })).toEqual({
      ok: false,
      error: { kind: "unreadable" },
    });
  });

  it.each([
    ["a review with no id", { ...CHUNK, reviews: [{ ...REVIEW, id: "x" }] }],
    ["the same review twice", { ...CHUNK, reviews: [REVIEW, REVIEW] }],
    ["an unknown table", withEntity({ ...change, table: "journal", key: "k", value: {} })],
    ["a synced review row", withEntity({ ...change, table: "reviews", key: "k", value: REVIEW })],
    ["a live row with no value", withEntity({ ...change, table: "notes", key: "k", value: null })],
    [
      "a deleted row with a value",
      withEntity({ changedAt: 5, deleted: true, table: "notes", key: NOTE.id, value: NOTE }),
    ],
    ["a key another row owns", withEntity({ ...change, table: "notes", key: "k", value: NOTE })],
    [
      "a deck word under another key",
      withEntity({
        ...change,
        table: "deckWords",
        key: deckWordId(MY_WORDS, WORD),
        value: { deckId: DECK, ...WORD },
      }),
    ],
    [
      "a deck whose id is no UUID",
      withEntity({ ...change, table: "decks", key: "d", value: { id: "d", name: "Voyage" } }),
    ],
    [
      "a card whose id does not match",
      withEntity({ ...change, table: "cards", key: "c", value: { ...CARD, id: "c" } }),
    ],
    [
      "a deletion of a card with no card id",
      withEntity({ changedAt: 5, deleted: true, table: "cards", key: "c", value: null }),
    ],
    [
      "a deletion of a deck word with no deck word id",
      withEntity({ changedAt: 5, deleted: true, table: "deckWords", key: "c", value: null }),
    ],
    [
      "a deletion of a deck with no deck id",
      withEntity({ changedAt: 5, deleted: true, table: "decks", key: "c", value: null }),
    ],
    [
      "a deletion of a mark with no mark key",
      withEntity({ changedAt: 5, deleted: true, table: "knownMarks", key: "c", value: null }),
    ],
    [
      "a negative time",
      withEntity({ changedAt: -1, deleted: true, table: "notes", key: "n", value: null }),
    ],
  ])("%s is unreadable", async (_name, json) => {
    expect(await decodeJson(json)).toEqual({ ok: false, error: { kind: "unreadable" } });
  });

  it("gives a value the same shape whatever the sender's key order", async () => {
    const shuffled = {
      updatedAt: NOTE.updatedAt,
      provenance: NOTE.provenance,
      meaning: NOTE.meaning,
      pinyin: NOTE.pinyin,
      characters: NOTE.characters,
      id: NOTE.id,
    };
    const decoded = await decodeJson(
      withEntity({ ...change, table: "notes", key: NOTE.id, value: shuffled }),
    );
    expect(JSON.stringify(decoded)).toBe(
      JSON.stringify(
        await decodeJson(withEntity({ ...change, table: "notes", key: NOTE.id, value: NOTE })),
      ),
    );
  });
});
