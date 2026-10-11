import {
  CardType,
  dueToday,
  err,
  newCards,
  ok,
  proficiencyFrameworks,
  replay,
  type Result,
  type WordKey,
} from "@openlinguo/core";
import type { ZhProficiency } from "@openlinguo/lang-zh";
import {
  deckWordId,
  MY_WORDS,
  type Database,
  type StoredCard,
  type StoredDeck,
  type StoredEntry,
} from "./database.ts";
import { describeFailure, guarded, type ReviewLogFailure } from "./review-log.ts";

/** A time with the local offset it was read in, as reviews store it. */
export type LocalTime = { readonly at: number; readonly utcOffsetMinutes: number };

export const localNow = (): LocalTime => {
  const now = new Date();
  return { at: now.getTime(), utcOffsetMinutes: -now.getTimezoneOffset() };
};

export type DeckCounts = { readonly new: number; readonly learning: number; readonly due: number };

/** A personal deck; « My words » has no stored name. */
export type Deck = { readonly id: string; readonly name: string | null };

export type PersonalDeck = Deck & {
  readonly counts: DeckCounts;
  /** Readings that leave the queue if the deck is deleted. */
  readonly leaving: number;
};

export type Decks = {
  readonly personal: readonly PersonalDeck[];
  readonly bands: readonly DeckCounts[];
};

export type WordDecks = { readonly decks: readonly Deck[]; readonly filed: ReadonlySet<string> };

export const DECK_NAME_MAX = 40;

export type DeckNameProblem = "empty" | "too-long" | "taken";

export type DeckFailure =
  ReviewLogFailure | { readonly kind: "unknown-deck"; readonly deckId: string };

export type DeckNameFailure =
  DeckFailure | { readonly kind: "deck-name"; readonly problem: DeckNameProblem };

export const describeDeckFailure = (failure: DeckFailure): string =>
  failure.kind === "unknown-deck" ? `${failure.kind} ${failure.deckId}` : describeFailure(failure);

const LEVEL = {
  "hsk-2025": "hsk2025",
  "gf0025-2021": "gf0025",
} as const satisfies Record<ZhProficiency, keyof StoredEntry>;

/** Sorts deck names; names equal for it are the same name. */
const names = new Intl.Collator([], { sensitivity: "accent" });

export const entryId = ({ headword, readingKey }: WordKey): string => `${headword}\t${readingKey}`;

const cardIds = ({ headword, readingKey }: WordKey): string[] =>
  newCards("zh", headword, readingKey).map((card) => card.id);

/** « My words » first, then the learner's decks by name. */
const listDecks = async (db: Database): Promise<Deck[]> => [
  { id: MY_WORDS, name: null },
  ...(await db.decks.toArray()).sort((a, b) => names.compare(a.name, b.name)),
];

const checkName = async (
  db: Database,
  name: string,
  renamed: string | null,
): Promise<Result<string, DeckNameFailure>> => {
  const trimmed = name.trim();
  if (trimmed === "") return err({ kind: "deck-name", problem: "empty" });
  if (trimmed.length > DECK_NAME_MAX) return err({ kind: "deck-name", problem: "too-long" });
  const decks = await db.decks.toArray();
  return decks.some((deck) => deck.id !== renamed && names.compare(deck.name, trimmed) === 0)
    ? err({ kind: "deck-name", problem: "taken" })
    : ok(trimmed);
};

export const createDeck = (
  db: Database,
  name: string,
): Promise<Result<StoredDeck, DeckNameFailure>> =>
  guarded(() =>
    db.transaction("rw", db.decks, async (): Promise<Result<StoredDeck, DeckNameFailure>> => {
      const checked = await checkName(db, name, null);
      if (!checked.ok) return checked;
      const deck = { id: crypto.randomUUID(), name: checked.value };
      await db.decks.add(deck);
      return ok(deck);
    }),
  );

export const renameDeck = (
  db: Database,
  deckId: string,
  name: string,
): Promise<Result<StoredDeck, DeckNameFailure>> =>
  guarded(() =>
    db.transaction("rw", db.decks, async (): Promise<Result<StoredDeck, DeckNameFailure>> => {
      const deck = await db.decks.get(deckId);
      if (deck == null) return err({ kind: "unknown-deck", deckId });
      const checked = await checkName(db, name, deckId);
      if (!checked.ok) return checked;
      const renamed = { ...deck, name: checked.value };
      await db.decks.put(renamed);
      return ok(renamed);
    }),
  );

/** Stores a reading's missing cards with their state replayed from the log. */
const putCards = async (db: Database, word: WordKey): Promise<Result<null, ReviewLogFailure>> => {
  const cards = newCards("zh", word.headword, word.readingKey);
  const stored = await db.cards.bulkGet(cards.map((card) => card.id));
  const missing: StoredCard[] = [];
  for (const [index, card] of cards.entries()) {
    if (stored[index] != null) continue;
    const state = replay(card.id, await db.reviews.where("cardId").equals(card.id).toArray());
    if (!state.ok) return state;
    missing.push({ ...card, ...state.value });
  }
  await db.cards.bulkPut(missing);
  return ok(null);
};

/** A reading in no deck leaves the queue, unless a band of the referential has it. */
const dropUnfiled = async (
  db: Database,
  word: WordKey,
  referential: ZhProficiency,
): Promise<void> => {
  const filed = await db.deckWords
    .where("[headword+readingKey]")
    .equals([word.headword, word.readingKey])
    .count();
  const level = (await db.entries.get(entryId(word)))?.[LEVEL[referential]] ?? null;
  if (filed === 0 && level === null) await db.cards.bulkDelete(cardIds(word));
};

/** Stores the cards of a band word the session shows for the first time. */
export const introduceWord = (
  db: Database,
  word: WordKey,
): Promise<Result<null, ReviewLogFailure>> =>
  guarded(() => db.transaction("rw", [db.cards, db.reviews], () => putCards(db, word)));

/**
 * Files a reading in a deck, with its progress back if it was filed before, or takes it out.
 * Reviews always stay in the log.
 */
export const fileWord = (
  db: Database,
  deckId: string,
  word: WordKey,
  filed: boolean,
  referential: ZhProficiency,
): Promise<Result<null, DeckFailure>> =>
  guarded(() =>
    db.transaction(
      "rw",
      [db.decks, db.deckWords, db.cards, db.reviews, db.entries],
      async (): Promise<Result<null, DeckFailure>> => {
        if (deckId !== MY_WORDS && (await db.decks.get(deckId)) == null)
          return err({ kind: "unknown-deck", deckId });
        const id = deckWordId(deckId, word);
        if (!filed) {
          await db.deckWords.delete(id);
          await dropUnfiled(db, word, referential);
          return ok(null);
        }
        const stored = await putCards(db, word);
        if (!stored.ok) return stored;
        await db.deckWords.put({
          id,
          deckId,
          headword: word.headword,
          readingKey: word.readingKey,
        });
        return ok(null);
      },
    ),
  );

/** Deletes a learner's deck; its readings in no other deck leave the queue as in `fileWord`. */
export const deleteDeck = (
  db: Database,
  deckId: string,
  referential: ZhProficiency,
): Promise<Result<null, DeckFailure>> =>
  guarded(() =>
    db.transaction(
      "rw",
      [db.decks, db.deckWords, db.cards, db.entries],
      async (): Promise<Result<null, DeckFailure>> => {
        if ((await db.decks.get(deckId)) == null) return err({ kind: "unknown-deck", deckId });
        const words = await db.deckWords.where("deckId").equals(deckId).toArray();
        await db.deckWords.bulkDelete(words.map((word) => word.id));
        await db.decks.delete(deckId);
        for (const word of words) await dropUnfiled(db, word, referential);
        return ok(null);
      },
    ),
  );

/** Every personal deck and those the reading is filed in. */
export const wordDecks = (
  db: Database,
  word: WordKey,
): Promise<Result<WordDecks, ReviewLogFailure>> =>
  guarded(async () => {
    const decks = await listDecks(db);
    const rows = await db.deckWords
      .where("[headword+readingKey]")
      .equals([word.headword, word.readingKey])
      .toArray();
    return ok({ decks, filed: new Set(rows.map((row) => row.deckId)) });
  });

type Tally = { new: number; learning: number; due: number };

/** Started cards count until the end of the current learning day. */
const tally = (counts: Tally, card: StoredCard, now: LocalTime): void => {
  if (card.phase === "new") {
    counts.new += 1;
  } else if (dueToday(card.due, now.at, now.utcOffsetMinutes)) {
    counts[card.phase === "review" ? "due" : "learning"] += 1;
  }
};

/** Card counts of each personal deck and each band, whose readings without cards count as new. */
export const deckCounts = (
  db: Database,
  referential: ZhProficiency,
  now: LocalTime,
): Promise<Result<Decks, ReviewLogFailure>> =>
  guarded(async () => {
    const field = LEVEL[referential];
    const cards = await db.cards.toArray();
    const entries = await db.entries.bulkGet(cards.map(entryId));
    const bands: Tally[] = await Promise.all(
      proficiencyFrameworks[referential].map(async (_, index) => ({
        new:
          (await db.entries
            .where(field)
            .equals(index + 1)
            .count()) * CardType.options.length,
        learning: 0,
        due: 0,
      })),
    );
    const graded = new Set<string>();
    cards.forEach((card, index) => {
      const level = entries[index]?.[field] ?? null;
      const band = level === null ? null : (bands[level - 1] ?? null);
      if (band === null) return;
      graded.add(entryId(card));
      // The stored card replaces one of the band's virtual new cards.
      band.new -= 1;
      tally(band, card, now);
    });
    const cardsOf = Map.groupBy(cards, entryId);
    const words = await db.deckWords.toArray();
    const decksOf = Map.groupBy(words, entryId);
    const wordsOf = Map.groupBy(words, (word) => word.deckId);
    const personal = (await listDecks(db)).map((deck) => {
      const counts: Tally = { new: 0, learning: 0, due: 0 };
      let leaving = 0;
      for (const word of wordsOf.get(deck.id) ?? []) {
        const id = entryId(word);
        for (const card of cardsOf.get(id) ?? []) tally(counts, card, now);
        if (decksOf.get(id)?.length === 1 && !graded.has(id)) leaving += 1;
      }
      return { ...deck, counts, leaving };
    });
    return ok({ personal, bands });
  });

type Candidate = WordKey & { readonly level: number | null; readonly frequency: number | null };

const byPriority = (a: Candidate, b: Candidate): number => {
  const ids = [entryId(a), entryId(b)] as const;
  return (
    (a.level ?? Number.MAX_SAFE_INTEGER) - (b.level ?? Number.MAX_SAFE_INTEGER) ||
    (b.frequency ?? 0) - (a.frequency ?? 0) ||
    (ids[0] < ids[1] ? -1 : ids[0] > ids[1] ? 1 : 0)
  );
};

/** Readings to introduce next: personal decks, then the bands, each by level then frequency (Pareto). */
export const nextNewReadings = (
  db: Database,
  referential: ZhProficiency,
  limit: number,
): Promise<Result<readonly WordKey[], ReviewLogFailure>> =>
  guarded(async () => {
    const field = LEVEL[referential];
    const cards = await db.cards.toArray();
    const carded = new Set(cards.map(entryId));
    const started = new Set(cards.filter((card) => card.phase !== "new").map(entryId));
    const personal = new Map(
      (await db.deckWords.toArray())
        .filter((word) => !started.has(entryId(word)))
        .map((word) => [entryId(word), word] as const),
    );
    const entries = await db.entries.bulkGet([...personal.keys()]);
    const queue: Candidate[] = [...personal.values()]
      .map((word, index) => ({
        headword: word.headword,
        readingKey: word.readingKey,
        level: entries[index]?.[field] ?? null,
        frequency: entries[index]?.frequency ?? null,
      }))
      .sort(byPriority);
    const levels = proficiencyFrameworks[referential].length;
    for (let level = 1; level <= levels && queue.length < limit; level += 1) {
      const rows = await db.entries.where(field).equals(level).toArray();
      queue.push(
        ...rows
          .filter((row) => !carded.has(row.id) && !personal.has(row.id))
          .map((row) => ({
            headword: row.simplified,
            readingKey: row.id.slice(row.simplified.length + 1),
            level,
            frequency: row.frequency,
          }))
          .sort(byPriority),
      );
    }
    return ok(queue.slice(0, limit).map(({ headword, readingKey }) => ({ headword, readingKey })));
  });
