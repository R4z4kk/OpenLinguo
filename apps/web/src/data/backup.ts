import { Card, err, ok, replay, Review, type ReplayError, type Result } from "@openlinguo/core";
import { z } from "zod";
import { languages } from "@/i18n/language";
import { themePreferences } from "@/theme";
import {
  deckWordId,
  MY_WORDS,
  type Database,
  type StoredCard,
  type StoredDeck,
  type StoredDeckWord,
} from "./database.ts";
import { DECK_NAME_MAX, sameDeckName, type DeckFailure } from "./decks.ts";
import { referentials } from "./referential.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

export const BACKUP_FORMAT = "openlinguo-backup";
export const BACKUP_VERSION = 1;

export const Settings = z.object({
  language: z.enum(languages),
  theme: z.enum(themePreferences),
  referential: z.enum(referentials),
});
export type Settings = z.output<typeof Settings>;

const Header = z.object({ format: z.literal(BACKUP_FORMAT), version: z.number().int().min(1) });

/** Learning data and settings, without dictionary data; card states are replayed from the log. */
export const Backup = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    version: z.literal(BACKUP_VERSION),
    exportedAt: z.iso.datetime(),
    settings: Settings,
    cards: z.array(Card),
    reviews: z.array(Review),
    decks: z.array(z.object({ id: z.uuid(), name: z.string().trim().min(1).max(DECK_NAME_MAX) })),
    deckWords: z.array(
      z.object({
        deckId: z.union([z.literal(MY_WORDS), z.uuid()]),
        headword: z.string().min(1),
        readingKey: z.string().min(1),
      }),
    ),
  })
  .superRefine(({ reviews, decks, deckWords }, context) => {
    const issue = (path: (string | number)[], message: string): void => {
      context.addIssue({ code: "custom", path, message });
    };
    const reviewIds = new Set<string>();
    reviews.forEach(({ id }, index) => {
      if (reviewIds.has(id)) issue(["reviews", index, "id"], "Duplicate review id");
      reviewIds.add(id);
    });
    decks.forEach((deck, index) => {
      const earlier = decks.slice(0, index);
      if (earlier.some((other) => other.id === deck.id))
        issue(["decks", index, "id"], "Duplicate deck id");
      else if (earlier.some((other) => sameDeckName(other.name, deck.name)))
        issue(["decks", index, "name"], "Another deck has this name");
    });
    const deckIds = new Set([MY_WORDS, ...decks.map((deck) => deck.id)]);
    deckWords.forEach(({ deckId }, index) => {
      if (!deckIds.has(deckId)) issue(["deckWords", index, "deckId"], "No deck has this id");
    });
  });
export type Backup = z.output<typeof Backup>;

export type BackupIssue = { readonly path: string; readonly message: string };

export type BackupFailure =
  | { readonly kind: "not-json"; readonly message: string }
  | { readonly kind: "not-backup" }
  | { readonly kind: "newer-version"; readonly version: number }
  | { readonly kind: "invalid"; readonly issues: readonly BackupIssue[] };

export const parseBackup = (text: string): Result<Backup, BackupFailure> => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return err({ kind: "not-json", message: String(error) });
  }
  const header = Header.safeParse(json);
  if (!header.success) return err({ kind: "not-backup" });
  if (header.data.version > BACKUP_VERSION)
    return err({ kind: "newer-version", version: header.data.version });
  const backup = Backup.safeParse(json);
  return backup.success
    ? ok(backup.data)
    : err({
        kind: "invalid",
        issues: backup.error.issues.map(({ path, message }) => ({
          path: path.map(String).join("."),
          message,
        })),
      });
};

export const exportBackup = (
  db: Database,
  settings: Settings,
  now: Date,
): Promise<Result<Backup, ReviewLogFailure>> =>
  guarded(() =>
    db.transaction(
      "r",
      [db.cards, db.reviews, db.decks, db.deckWords],
      async (): Promise<Result<Backup, ReviewLogFailure>> =>
        ok({
          format: BACKUP_FORMAT,
          version: BACKUP_VERSION,
          exportedAt: now.toISOString(),
          settings,
          cards: (await db.cards.toArray()).map(({ id, language, headword, readingKey, type }) => ({
            id,
            language,
            headword,
            readingKey,
            type,
          })),
          reviews: await db.reviews.toArray(),
          decks: await db.decks.toArray(),
          deckWords: (await db.deckWords.toArray()).map(({ deckId, headword, readingKey }) => ({
            deckId,
            headword,
            readingKey,
          })),
        }),
    ),
  );

/** What an import added. */
export type ImportSummary = {
  readonly reviews: number;
  readonly cards: number;
  readonly decks: number;
  readonly words: number;
};

const replayCards = (
  cards: readonly Card[],
  reviews: readonly Review[],
): Result<StoredCard[], ReplayError> => {
  const logs = Map.groupBy(reviews, (review) => review.cardId);
  const replayed: StoredCard[] = [];
  for (const card of cards) {
    const state = replay(card.id, logs.get(card.id) ?? []);
    if (!state.ok) return state;
    replayed.push({ ...card, ...state.value });
  }
  return ok(replayed);
};

/**
 * Merges by ids, so importing twice changes nothing: the union of review logs, then every card
 * replayed. A local deck keeps its name and takes in an imported deck of the same id or name.
 * Nothing is written unless the whole merge succeeds.
 */
export const importBackup = (
  db: Database,
  backup: Backup,
): Promise<Result<ImportSummary, DeckFailure>> =>
  guarded(() =>
    db.transaction(
      "rw",
      [db.cards, db.reviews, db.decks, db.deckWords],
      async (): Promise<Result<ImportSummary, DeckFailure>> => {
        const reviews = await db.reviews.toArray();
        const reviewIds = new Set(reviews.map((review) => review.id));
        const newReviews = backup.reviews.filter((review) => !reviewIds.has(review.id));
        const cards = new Map<string, Card>(
          (await db.cards.toArray()).map((card) => [card.id, card]),
        );
        const localCards = cards.size;
        for (const card of backup.cards) if (!cards.has(card.id)) cards.set(card.id, card);
        const replayed = replayCards([...cards.values()], [...reviews, ...newReviews]);
        if (!replayed.ok) return replayed;

        const decks = await db.decks.toArray();
        const deckIds = new Map([[MY_WORDS, MY_WORDS]]);
        const newDecks: StoredDeck[] = [];
        for (const deck of backup.decks) {
          const local =
            decks.find((other) => other.id === deck.id) ??
            decks.find((other) => sameDeckName(other.name, deck.name)) ??
            null;
          deckIds.set(deck.id, local?.id ?? deck.id);
          if (local === null) newDecks.push(deck);
        }
        const words = new Map<string, StoredDeckWord>();
        for (const { deckId: imported, headword, readingKey } of backup.deckWords) {
          const deckId = deckIds.get(imported) ?? null;
          if (deckId === null) return err({ kind: "unknown-deck", deckId: imported });
          const id = deckWordId(deckId, { headword, readingKey });
          words.set(id, { id, deckId, headword, readingKey });
        }
        const filed = await db.deckWords.bulkGet([...words.keys()]);
        const newWords = [...words.values()].filter((_, index) => filed[index] == null);

        await db.reviews.bulkAdd(newReviews);
        await db.cards.bulkPut(replayed.value);
        await db.decks.bulkAdd(newDecks);
        await db.deckWords.bulkAdd(newWords);
        return ok({
          reviews: newReviews.length,
          cards: cards.size - localCards,
          decks: newDecks.length,
          words: newWords.length,
        });
      },
    ),
  );
