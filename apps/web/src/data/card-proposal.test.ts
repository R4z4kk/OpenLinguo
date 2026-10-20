import "fake-indexeddb/auto";
import {
  cardId,
  err,
  ok,
  type AiProvenance,
  type PromptPack,
  type ReadingCheckError,
  type ReadingMismatch,
  type Result,
} from "@openlinguo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkProposal, fileNote, isReady, proposeNote } from "./card-proposal.ts";
import type { SentenceCorrection } from "./correction.ts";
import { MY_WORDS, openDatabase, type Database, type NoteContent } from "./database.ts";
import { createDeck } from "./decks.ts";

const PROVENANCE: AiProvenance = {
  origin: "ai",
  provider: "local",
  model: "qwen3:30b-a3b",
  promptVersion: "zh-correct-v1",
  createdAt: "2026-10-19T14:03:27.512Z",
};

const CORRECTION: SentenceCorrection = {
  original: "我电话很新。",
  corrected: "我的电话很新。",
  changes: [{ from: "我电话", to: "我的电话", explanation: "Adds the possessive 的." }],
  reading: "wǒ de diàn huà hěn xīn .",
  meaning: "My phone is new.",
  choice: "accepted",
  provenance: PROVENANCE,
};

const NOTE: NoteContent = {
  characters: "我的电话很新。",
  pinyin: "wǒ de diàn huà hěn xīn .",
  meaning: "My phone is new.",
};

const XIN: ReadingMismatch = { start: 5, end: 6, written: "xin4", readings: ["xin1"] };

const answering = (result: Result<readonly ReadingMismatch[], ReadingCheckError>) =>
  vi.fn<PromptPack["checkReading"]>(() => Promise.resolve(result));

describe("proposeNote", () => {
  it("proposes the accepted sentence with the AI's pinyin and meaning", () => {
    expect(proposeNote(CORRECTION)).toEqual(NOTE);
  });
});

describe("checkProposal", () => {
  it("passes a reading the dictionary gives, checked without the surrounding spaces", async () => {
    const checkReading = answering(ok([]));
    const check = await checkProposal(
      { ...NOTE, characters: ` ${NOTE.characters} ` },
      checkReading,
    );
    expect(check).toEqual({ characters: null, pinyin: null, meaning: null });
    expect(isReady(check)).toBe(true);
    expect(checkReading).toHaveBeenCalledWith(NOTE.characters, NOTE.pinyin);
  });

  it("flags each syllable the dictionary does not give, and refuses the note", async () => {
    const check = await checkProposal(
      { ...NOTE, pinyin: "wǒ de diàn huà hěn xìn ." },
      answering(ok([XIN])),
    );
    expect(check.pinyin).toEqual({ kind: "mismatch", mismatches: [{ ...XIN, character: "新" }] });
    expect(isReady(check)).toBe(false);
  });

  it("flags a reading that does not follow the characters", async () => {
    const invalid = { kind: "invalid-reading", reading: "wǒ de" } as const;
    const check = await checkProposal({ ...NOTE, pinyin: "wǒ de" }, answering(err(invalid)));
    expect(check.pinyin).toEqual(invalid);
    expect(isReady(check)).toBe(false);
  });

  it("refuses the note when the dictionary cannot be read", async () => {
    const missing = { kind: "dataset-missing", dataset: "cc-cedict" } as const;
    expect((await checkProposal(NOTE, answering(err(missing)))).pinyin).toEqual(missing);
    const broken = vi.fn<PromptPack["checkReading"]>(() =>
      Promise.reject(new Error("UnknownError")),
    );
    const check = await checkProposal(NOTE, broken);
    expect(check.pinyin).toEqual({ kind: "storage-failure", message: "Error: UnknownError" });
    expect(isReady(check)).toBe(false);
  });

  it("asks for the sentence and the meaning", async () => {
    const check = await checkProposal(
      { characters: " ", pinyin: "", meaning: "\n" },
      answering(ok([])),
    );
    expect(check).toEqual({ characters: "empty", pinyin: null, meaning: "empty" });
    expect(isReady(check)).toBe(false);
  });
});

describe("fileNote", () => {
  let counter = 0;
  let db: Database;
  const NOW = 1_792_000_000_000;

  beforeEach(() => {
    counter += 1;
    db = openDatabase(`card-proposal-test-${String(counter)}`);
  });

  const deckOf = async (name: string): Promise<string> => {
    const created = await createDeck(db, name);
    if (!created.ok) throw new Error(created.error.kind);
    return created.value.id;
  };

  it("creates the note, trimmed, with recognition and recall cards in the deck and its provenance", async () => {
    expect(
      await fileNote(db, MY_WORDS, { ...NOTE, meaning: " My phone is new. " }, PROVENANCE, NOW),
    ).toEqual(ok(null));
    const [note] = await db.notes.toArray();
    const id = note?.id ?? "";
    expect(id).not.toBe("");
    expect(note).toEqual({ ...NOTE, id, updatedAt: NOW, provenance: PROVENANCE });
    expect(await db.deckWords.toArray()).toEqual([
      { id: `${MY_WORDS}\t\t${id}`, deckId: MY_WORDS, note: id },
    ]);
    expect((await db.cards.toArray()).map((card) => card.id).sort()).toEqual(
      [
        cardId({ language: "zh", note: id, type: "recall" }),
        cardId({ language: "zh", note: id, type: "recognition" }),
      ].sort(),
    );
  });

  it("files a sentence once per deck", async () => {
    const zoo = await deckOf("Zoo");
    expect(await fileNote(db, MY_WORDS, NOTE, PROVENANCE, NOW)).toEqual(ok(null));
    expect(
      await fileNote(db, MY_WORDS, { ...NOTE, characters: ` ${NOTE.characters}` }, PROVENANCE, NOW),
    ).toEqual(err({ kind: "already-filed" }));
    expect(await db.notes.count()).toBe(1);
    expect(await fileNote(db, zoo, NOTE, PROVENANCE, NOW)).toEqual(ok(null));
    expect(await db.notes.count()).toBe(2);
    expect(await db.cards.count()).toBe(4);
  });

  it("refuses an unknown deck and writes nothing when a write fails", async () => {
    expect(await fileNote(db, "gone", NOTE, PROVENANCE, NOW)).toEqual(
      err({ kind: "unknown-deck", deckId: "gone" }),
    );
    vi.spyOn(db.deckWords, "add").mockRejectedValueOnce(new Error("QuotaExceededError"));
    expect(await fileNote(db, MY_WORDS, NOTE, PROVENANCE, NOW)).toEqual(
      err({ kind: "storage", message: "Error: QuotaExceededError" }),
    );
    expect(await db.notes.count()).toBe(0);
    expect(await db.cards.count()).toBe(0);
  });
});
