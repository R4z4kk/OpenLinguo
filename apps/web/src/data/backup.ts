import {
  AiProvenance,
  Card,
  err,
  ok,
  replay,
  Review,
  subjectOf,
  type ReplayError,
  type Result,
} from "@openlinguo/core";
import { z } from "zod";
import { languages } from "@/i18n/language";
import { themePreferences } from "@/theme";
import { DAILY_GOAL, NEW_CARDS_PER_DAY } from "./daily-goal.ts";
import { PRACTICE_TYPING, PRACTICE_WRITING, WRITE_ON_PAPER } from "./practice.ts";
import {
  deckWordId,
  MY_WORDS,
  type Database,
  type StoredCard,
  type StoredDeck,
  type StoredDeckWord,
  type StoredNote,
} from "./database.ts";
import { DECK_NAME_MAX, sameDeckName, type DeckFailure } from "./decks.ts";
import { Interests } from "./interests.ts";
import { SHOW_PROGRESS } from "./progress.ts";
import { referentials } from "./referential.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

export const BACKUP_FORMAT = "openlinguo-backup";
export const BACKUP_VERSION = 1;

/** Settings added later default to their fallback, so older backups still import. */
export const Settings = z.object({
  language: z.enum(languages),
  theme: z.enum(themePreferences),
  referential: z.enum(referentials),
  dailyGoal: z.literal(DAILY_GOAL.values).default(DAILY_GOAL.fallback),
  newCardsPerDay: z.literal(NEW_CARDS_PER_DAY.values).default(NEW_CARDS_PER_DAY.fallback),
  showProgress: z.boolean().default(SHOW_PROGRESS.fallback),
  practiceTyping: z.boolean().default(PRACTICE_TYPING.fallback),
  practiceWriting: z.boolean().default(PRACTICE_WRITING.fallback),
  writeOnPaper: z.boolean().default(WRITE_ON_PAPER.fallback),
  /** `null`: none to restore, so an older backup leaves the device's own. */
  interests: Interests.nullable().default(null),
});
export type Settings = z.output<typeof Settings>;

const Header = z.object({ format: z.literal(BACKUP_FORMAT), version: z.number().int().min(1) });

const DeckId = z.union([z.literal(MY_WORDS), z.uuid()]);

/** Learning data and settings, without dictionary data; card states are replayed from the log. */
export const Backup = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    version: z.literal(BACKUP_VERSION),
    exportedAt: z.iso.datetime(),
    settings: Settings,
    cards: z.array(Card),
    reviews: z.array(
      Review.extend({ dailyGoal: Review.shape.dailyGoal.default(DAILY_GOAL.fallback) }),
    ),
    decks: z.array(z.object({ id: z.uuid(), name: z.string().trim().min(1).max(DECK_NAME_MAX) })),
    deckWords: z.array(
      z.union([
        z.object({ deckId: DeckId, headword: z.string().min(1), readingKey: z.string().min(1) }),
        z.object({ deckId: DeckId, note: z.string().min(1) }),
      ]),
    ),
    notes: z
      .array(
        z.object({
          id: z.string().min(1),
          characters: z.string().min(1),
          pinyin: z.string(),
          meaning: z.string().min(1),
          updatedAt: z.number().int().nonnegative(),
          // Backups made before M5 have no AI notes.
          provenance: AiProvenance.nullable().default(null),
        }),
      )
      .default([]),
  })
  .superRefine(({ reviews, decks, deckWords, notes }, context) => {
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
    const noteIds = new Set<string>();
    notes.forEach(({ id }, index) => {
      if (noteIds.has(id)) issue(["notes", index, "id"], "Duplicate note id");
      noteIds.add(id);
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
      [db.cards, db.reviews, db.decks, db.deckWords, db.notes],
      async (): Promise<Result<Backup, ReviewLogFailure>> =>
        ok({
          format: BACKUP_FORMAT,
          version: BACKUP_VERSION,
          exportedAt: now.toISOString(),
          settings,
          cards: (await db.cards.toArray()).map((card) => ({
            ...subjectOf(card),
            id: card.id,
            language: card.language,
            type: card.type,
          })),
          reviews: await db.reviews.toArray(),
          decks: await db.decks.toArray(),
          deckWords: (await db.deckWords.toArray()).map((word) => ({
            ...subjectOf(word),
            deckId: word.deckId,
          })),
          notes: await db.notes.toArray(),
        }),
    ),
  );

/** What an import added. */
export type ImportSummary = {
  readonly reviews: number;
  readonly cards: number;
  readonly decks: number;
  readonly words: number;
  readonly notes: number;
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
 * replayed. A local deck keeps its name and takes in an imported deck of the same id or name; a
 * note keeps its latest content. Nothing is written unless the whole merge succeeds.
 */
export const importBackup = (
  db: Database,
  backup: Backup,
): Promise<Result<ImportSummary, DeckFailure>> =>
  guarded(() =>
    db.transaction(
      "rw",
      [db.cards, db.reviews, db.decks, db.deckWords, db.notes],
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
        for (const word of backup.deckWords) {
          const deckId = deckIds.get(word.deckId) ?? null;
          if (deckId === null) return err({ kind: "unknown-deck", deckId: word.deckId });
          const subject = subjectOf(word);
          const id = deckWordId(deckId, subject);
          words.set(id, { ...subject, id, deckId });
        }
        const filed = await db.deckWords.bulkGet([...words.keys()]);
        const newWords = [...words.values()].filter((_, index) => filed[index] == null);
        const localNotes = await db.notes.bulkGet(backup.notes.map((note) => note.id));
        const newerNotes: StoredNote[] = backup.notes.filter(
          (note, index) => note.updatedAt > (localNotes[index]?.updatedAt ?? -1),
        );

        await db.reviews.bulkAdd(newReviews);
        await db.cards.bulkPut(replayed.value);
        await db.decks.bulkAdd(newDecks);
        await db.deckWords.bulkAdd(newWords);
        await db.notes.bulkPut(newerNotes);
        return ok({
          reviews: newReviews.length,
          cards: cards.size - localCards,
          decks: newDecks.length,
          words: newWords.length,
          notes: newerNotes.length,
        });
      },
    ),
  );
