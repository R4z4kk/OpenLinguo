import { Card, err, NEW_CARD_STATE, ok, replay, subjectOf, type Result } from "@openlinguo/core";
import { Dexie } from "dexie";
import { DeckRow, DeckWordRow, KnownMarkRow, NoteRow } from "./backup.ts";
import { MY_WORDS, type Database, type StoredDeckWord } from "./database.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";
import {
  parseDeckWordId,
  parseKnownMarkKey,
  type SyncChunk,
  type SyncedEntity,
} from "./sync-chunk.ts";
import { silently, type SyncedTable, type SyncEntity } from "./sync-entities.ts";

type Row<T extends SyncedEntity["table"]> = Extract<SyncedEntity, { table: T }>;

/** Thrown to roll the transaction back with a failure the caller can tell apart. */
class MergeFailure extends Error {
  readonly failure: ReviewLogFailure;

  constructor(failure: ReviewLogFailure) {
    super(failure.kind);
    this.failure = failure;
  }
}

const wins = (incoming: SyncedEntity, local: SyncEntity | null, localValue: unknown): boolean => {
  if (local === null) return true;
  if (incoming.changedAt !== local.changedAt) return incoming.changedAt > local.changedAt;
  if (incoming.deleted !== local.deleted) return incoming.deleted;
  return JSON.stringify(incoming.value) > JSON.stringify(localValue);
};

const entityId = (table: SyncedTable, key: string): string => `${table}:${key}`;

const applied = ({ table, key, changedAt, deleted }: SyncedEntity): SyncEntity => ({
  id: entityId(table, key),
  table,
  key,
  changedAt,
  deleted,
  pending: 0,
});

/** The local value of a tied change, in the shape a decoded chunk has; `null` when none is stored. */
const tiedValue = async (db: Database, incoming: SyncedEntity): Promise<unknown> => {
  switch (incoming.table) {
    case "cards": {
      const card = await db.cards.get(incoming.key);
      return card == null ? null : Card.parse(card);
    }
    case "decks": {
      const deck = await db.decks.get(incoming.key);
      return deck == null ? null : DeckRow.parse(deck);
    }
    case "deckWords": {
      const word = await db.deckWords.get(incoming.key);
      return word == null ? null : DeckWordRow.parse(word);
    }
    case "notes": {
      const note = await db.notes.get(incoming.key);
      return note == null ? null : NoteRow.parse(note);
    }
    case "knownMarks": {
      const mark = await db.knownMarks.get(parseKnownMarkKey(incoming.key));
      return mark == null ? null : KnownMarkRow.parse(mark);
    }
  }
};

const decide = async (db: Database, incoming: SyncedEntity): Promise<boolean> => {
  const local = (await db.syncEntities.get(entityId(incoming.table, incoming.key))) ?? null;
  const tied = local !== null && !local.deleted && local.changedAt === incoming.changedAt;
  return wins(incoming, local, tied ? await tiedValue(db, incoming) : null);
};

const applyCard = async (
  db: Database,
  incoming: Row<"cards">,
  replays: Set<string>,
): Promise<void> => {
  if (!(await decide(db, incoming))) return;
  await db.syncEntities.put(applied(incoming));
  if (incoming.value === null) {
    await db.cards.delete(incoming.key);
  } else {
    await db.cards.put({ ...incoming.value, ...NEW_CARD_STATE });
    replays.add(incoming.key);
  }
};

/** Whether this device still files a note it holds: a deletion made elsewhere did not know. */
const keepsNote = async (db: Database, id: string): Promise<boolean> =>
  (await db.deckWords.where("note").equals(id).count()) > 0 && (await db.notes.get(id)) != null;

const applyNote = async (db: Database, incoming: Row<"notes">): Promise<void> => {
  if (!(await decide(db, incoming))) return;
  if (incoming.value === null && (await keepsNote(db, incoming.key))) {
    // A note cannot be rebuilt from the log: it is kept and sent again, past the deletion.
    await db.syncEntities.put({
      ...applied(incoming),
      changedAt: incoming.changedAt + 1,
      deleted: false,
      pending: 1,
    });
    return;
  }
  await db.syncEntities.put(applied(incoming));
  if (incoming.value === null) await db.notes.delete(incoming.key);
  else await db.notes.put(incoming.value);
};

const applyMark = async (db: Database, incoming: Row<"knownMarks">): Promise<void> => {
  if (!(await decide(db, incoming))) return;
  await db.syncEntities.put(applied(incoming));
  if (incoming.value === null) await db.knownMarks.delete(parseKnownMarkKey(incoming.key));
  else await db.knownMarks.put(incoming.value);
};

/** A deck is gone once its deletion is known; a deck not heard of yet may still arrive. */
const deckIsGone = async (db: Database, deckId: string): Promise<boolean> =>
  (await db.decks.get(deckId)) == null &&
  (await db.syncEntities.get(entityId("decks", deckId)))?.deleted === true;

const deckWordOf = (key: string, deckId: string): StoredDeckWord => {
  const parts = parseDeckWordId(key);
  if (parts === null) throw new Error(`Not a deck word id: ${key}`);
  return { ...subjectOf(parts.subject), id: key, deckId };
};

const applyWord = async (db: Database, incoming: Row<"deckWords">): Promise<void> => {
  if (!(await decide(db, incoming))) return;
  await db.syncEntities.put(applied(incoming));
  if (incoming.value === null) {
    await db.deckWords.delete(incoming.key);
    await db.audio.delete(incoming.key);
    return;
  }
  const { deckId } = incoming.value;
  if (deckId === MY_WORDS || !(await deckIsGone(db, deckId)))
    await db.deckWords.put(deckWordOf(incoming.key, deckId));
};

const applyDeck = async (db: Database, incoming: Row<"decks">): Promise<void> => {
  if (!(await decide(db, incoming))) return;
  await db.syncEntities.put(applied(incoming));
  if (incoming.value === null) {
    // The rows go, their entities stay, in case a later change brings the deck back.
    const words = await db.deckWords.where("deckId").equals(incoming.key).primaryKeys();
    await db.deckWords.bulkDelete(words);
    await db.audio.bulkDelete(words);
    await db.decks.delete(incoming.key);
    return;
  }
  await db.decks.put(incoming.value);
  const known = await db.syncEntities
    .where("id")
    .startsWith(entityId("deckWords", `${incoming.key}\t`))
    .toArray();
  await db.deckWords.bulkPut(
    known.filter(({ deleted }) => !deleted).map(({ key }) => deckWordOf(key, incoming.key)),
  );
};

const APPLY_ORDER: readonly SyncedEntity["table"][] = [
  "decks",
  "deckWords",
  "notes",
  "knownMarks",
  "cards",
];

const applyEntity = (db: Database, incoming: SyncedEntity, replays: Set<string>): Promise<void> => {
  switch (incoming.table) {
    case "decks":
      return applyDeck(db, incoming);
    case "deckWords":
      return applyWord(db, incoming);
    case "notes":
      return applyNote(db, incoming);
    case "knownMarks":
      return applyMark(db, incoming);
    case "cards":
      return applyCard(db, incoming, replays);
  }
};

const replayCards = async (db: Database, replays: ReadonlySet<string>): Promise<void> => {
  for (const id of replays) {
    const card = await db.cards.get(id);
    if (card == null) continue;
    const state = replay(id, await db.reviews.where("cardId").equals(id).toArray());
    if (!state.ok) throw new MergeFailure(state.error);
    await db.cards.put({ ...card, ...state.value });
  }
};

/**
 * Merges a chunk from another device, or reads back one of this device's, in one transaction with
 * the cursor. Reviews merge by id; other entities keep the latest change, but for a deletion of a
 * note this device still files. Each row follows from what is known of it, so no order of chunks
 * can part devices. One exception: a restored backup that brings back a deck deleted elsewhere
 * leaves that deck's contents different until a word next changes (ADR 0016).
 */
export const applyChunk = async (
  db: Database,
  chunk: SyncChunk,
  chunkId: number,
): Promise<Result<null, ReviewLogFailure>> =>
  guarded(async () => {
    try {
      return await db.transaction(
        "rw",
        [
          db.reviews,
          db.cards,
          db.decks,
          db.deckWords,
          db.notes,
          db.knownMarks,
          db.audio,
          db.syncEntities,
          db.syncState,
        ],
        // Async itself: Dexie keeps the transaction across awaits only for an async scope.
        async () =>
          silently(db, async (): Promise<Result<null, ReviewLogFailure>> => {
            const transaction = Dexie.currentTransaction;
            const state = await db.syncState.get("state");
            if (state == null)
              return err({ kind: "storage", message: "Sync is off on this device" });
            const logged = await db.reviews.bulkGet(chunk.reviews.map(({ id }) => id));
            const reviews = chunk.reviews.filter((_, index) => logged[index] == null);
            await db.reviews.bulkAdd(reviews);
            // The store holds them now: a waiting row would only send them again.
            await db.syncEntities.bulkDelete(
              chunk.reviews
                .filter((_, index) => logged[index] != null)
                .map(({ id }) => entityId("reviews", id)),
            );
            const replays = new Set(reviews.map(({ cardId }) => cardId));
            for (const table of APPLY_ORDER)
              for (const entity of chunk.entities)
                if (entity.table === table) await applyEntity(db, entity, replays);
            await replayCards(db, replays);
            if (Dexie.currentTransaction !== transaction)
              throw new Error("The merge left its transaction");
            await db.syncState.update("state", { cursor: chunkId });
            return ok(null);
          }),
      );
    } catch (error) {
      if (error instanceof MergeFailure) return err(error.failure);
      throw error;
    }
  });
