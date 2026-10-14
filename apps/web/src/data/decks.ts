import {
  CardType,
  dueToday,
  err,
  isWord,
  newCards,
  ok,
  PAIRED_TYPES,
  proficiencyFrameworks,
  replay,
  subjectId,
  subjectOf,
  type Result,
  type Review,
  type Subject,
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

export const sameDeckName = (a: string, b: string): boolean => names.compare(a, b) === 0;

export const entryId = ({ headword, readingKey }: WordKey): string => `${headword}\t${readingKey}`;

const cardIds = (subject: Subject): string[] =>
  newCards("zh", subject, CardType.options).map((card) => card.id);

/** « My words » first, then the learner's decks by name. */
const listDecks = async (db: Database): Promise<Deck[]> => [
  { id: MY_WORDS, name: null },
  ...(await db.decks.toArray()).sort((a, b) => names.compare(a.name, b.name)),
];

/** The trimmed name when no other deck has it. */
export const checkName = async (
  db: Database,
  name: string,
  renamed: string | null,
): Promise<Result<string, DeckNameFailure>> => {
  const trimmed = name.trim();
  if (trimmed === "") return err({ kind: "deck-name", problem: "empty" });
  if (trimmed.length > DECK_NAME_MAX) return err({ kind: "deck-name", problem: "too-long" });
  const decks = await db.decks.toArray();
  return decks.some((deck) => deck.id !== renamed && sameDeckName(deck.name, trimmed))
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

/**
 * Stores the missing cards of the given types for readings and notes, and the reviews of their
 * cards not yet in the log, with every card they touch replayed from its merged log. Nothing is
 * written unless every replay succeeds. Returns the number of reviews added.
 */
export const putCards = async (
  db: Database,
  subjects: readonly Subject[],
  reviews: readonly Review[] = [],
  types: readonly CardType[] = PAIRED_TYPES,
): Promise<Result<number, ReviewLogFailure>> => {
  const cards = subjects.flatMap((subject) => newCards("zh", subject, types));
  const stored = await db.cards.bulkGet(cards.map((card) => card.id));
  const logged = await db.reviews.bulkGet(reviews.map((review) => review.id));
  const added = Map.groupBy(
    reviews.filter((_, index) => logged[index] == null),
    (review) => review.cardId,
  );
  const known = new Set(cards.map((card) => card.id));
  const foreign = [...added.keys()].find((id) => !known.has(id));
  if (foreign != null) return err({ kind: "unknown-card", cardId: foreign });
  const touched = cards.filter((card, index) => stored[index] == null || added.has(card.id));
  const logs = await Promise.all(
    touched.map((card) => db.reviews.where("cardId").equals(card.id).toArray()),
  );
  const replayed: StoredCard[] = [];
  for (const [index, card] of touched.entries()) {
    const state = replay(card.id, [...(logs[index] ?? []), ...(added.get(card.id) ?? [])]);
    if (!state.ok) return state;
    replayed.push({ ...card, ...state.value });
  }
  const newReviews = [...added.values()].flat();
  await db.reviews.bulkAdd(newReviews);
  await db.cards.bulkPut(replayed);
  return ok(newReviews.length);
};

/**
 * A reading in no deck leaves the queue, unless a band of the referential has it; a note in no
 * deck leaves it with its content.
 */
const dropUnfiled = async (
  db: Database,
  subject: Subject,
  referential: ZhProficiency,
): Promise<void> => {
  if ("note" in subject) {
    if ((await db.deckWords.where("note").equals(subject.note).count()) > 0) return;
    await db.notes.delete(subject.note);
    await db.cards.bulkDelete(cardIds(subject));
    return;
  }
  const filed = await db.deckWords
    .where("[headword+readingKey]")
    .equals([subject.headword, subject.readingKey])
    .count();
  const level = (await db.entries.get(entryId(subject)))?.[LEVEL[referential]] ?? null;
  if (filed === 0 && level === null) await db.cards.bulkDelete(cardIds(subject));
};

/** Stores the cards the session shows for the first time: a band word's, or a reading's tone card. */
export const introduceWord = (
  db: Database,
  subject: Subject,
  types: readonly CardType[] = PAIRED_TYPES,
): Promise<Result<null, ReviewLogFailure>> =>
  guarded(() =>
    db.transaction("rw", [db.cards, db.reviews], async () => {
      const stored = await putCards(db, [subject], [], types);
      return stored.ok ? ok(null) : stored;
    }),
  );

/**
 * Files a reading in a deck, with its progress back if it was filed before, or takes it out with
 * the audio the deck gave it. Reviews always stay in the log.
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
      [db.decks, db.deckWords, db.cards, db.reviews, db.entries, db.audio],
      async (): Promise<Result<null, DeckFailure>> => {
        if (deckId !== MY_WORDS && (await db.decks.get(deckId)) == null)
          return err({ kind: "unknown-deck", deckId });
        const id = deckWordId(deckId, word);
        if (!filed) {
          await db.deckWords.delete(id);
          await db.audio.delete(id);
          await dropUnfiled(db, word, referential);
          return ok(null);
        }
        const stored = await putCards(db, [word]);
        if (!stored.ok) return stored;
        await db.deckWords.put({ ...subjectOf(word), id, deckId });
        return ok(null);
      },
    ),
  );

/**
 * Deletes a learner's deck and its audio; its readings and notes in no other deck leave the queue
 * as in `fileWord`. Reviews stay in the log.
 */
export const deleteDeck = (
  db: Database,
  deckId: string,
  referential: ZhProficiency,
): Promise<Result<null, DeckFailure>> =>
  guarded(() =>
    db.transaction(
      "rw",
      [db.decks, db.deckWords, db.cards, db.entries, db.audio, db.notes],
      async (): Promise<Result<null, DeckFailure>> => {
        if ((await db.decks.get(deckId)) == null) return err({ kind: "unknown-deck", deckId });
        const words = await db.deckWords.where("deckId").equals(deckId).toArray();
        await db.deckWords.bulkDelete(words.map((word) => word.id));
        await db.audio.bulkDelete(words.map((word) => word.id));
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
    const wordCards = cards.filter(isWord);
    const entries = await db.entries.bulkGet(wordCards.map(entryId));
    const bands: Tally[] = await Promise.all(
      proficiencyFrameworks[referential].map(async (_, index) => ({
        new:
          (await db.entries
            .where(field)
            .equals(index + 1)
            .count()) * PAIRED_TYPES.length,
        learning: 0,
        due: 0,
      })),
    );
    const graded = new Set<string>();
    wordCards.forEach((card, index) => {
      const level = entries[index]?.[field] ?? null;
      const band = level === null ? null : (bands[level - 1] ?? null);
      if (band === null) return;
      graded.add(subjectId(card));
      // The stored card replaces one of the band's virtual new cards.
      band.new -= 1;
      tally(band, card, now);
    });
    const cardsOf = Map.groupBy(cards, subjectId);
    const words = await db.deckWords.toArray();
    const decksOf = Map.groupBy(words, subjectId);
    const wordsOf = Map.groupBy(words, (word) => word.deckId);
    const personal = (await listDecks(db)).map((deck) => {
      const counts: Tally = { new: 0, learning: 0, due: 0 };
      let leaving = 0;
      for (const word of wordsOf.get(deck.id) ?? []) {
        const id = subjectId(word);
        for (const card of cardsOf.get(id) ?? []) tally(counts, card, now);
        if (decksOf.get(id)?.length === 1 && !graded.has(id)) leaving += 1;
      }
      return { ...deck, counts, leaving };
    });
    return ok({ personal, bands });
  });

type Candidate = Subject & { readonly level: number | null; readonly frequency: number | null };

const byPriority = (a: Candidate, b: Candidate): number => {
  const ids = [subjectId(a), subjectId(b)] as const;
  return (
    (a.level ?? Number.MAX_SAFE_INTEGER) - (b.level ?? Number.MAX_SAFE_INTEGER) ||
    (b.frequency ?? 0) - (a.frequency ?? 0) ||
    (ids[0] < ids[1] ? -1 : ids[0] > ids[1] ? 1 : 0)
  );
};

/**
 * Readings and notes to introduce next: personal decks, then the bands, each by level then
 * frequency (Pareto); notes have neither.
 */
export const nextNewReadings = (
  db: Database,
  referential: ZhProficiency,
  limit: number,
): Promise<Result<readonly Subject[], ReviewLogFailure>> =>
  guarded(async () => {
    const field = LEVEL[referential];
    const cards = await db.cards.toArray();
    const carded = new Set(cards.map(subjectId));
    const started = new Set(cards.filter((card) => card.phase !== "new").map(subjectId));
    const personal = new Map(
      (await db.deckWords.toArray())
        .filter((word) => !started.has(subjectId(word)))
        .map((word) => [subjectId(word), subjectOf(word)] as const),
    );
    const words = [...personal.values()].filter(isWord);
    const entries = await db.entries.bulkGet(words.map(entryId));
    const queue: Candidate[] = [
      ...words.map((word, index) => ({
        ...word,
        level: entries[index]?.[field] ?? null,
        frequency: entries[index]?.frequency ?? null,
      })),
      ...[...personal.values()]
        .filter((subject) => "note" in subject)
        .map((note) => ({ ...note, level: null, frequency: null })),
    ].sort(byPriority);
    const levels = proficiencyFrameworks[referential].length;
    for (let level = 1; level <= levels && queue.length < limit; level += 1) {
      const rows = await db.entries.where(field).equals(level).toArray();
      queue.push(
        ...rows
          .map((row) => ({
            headword: row.simplified,
            readingKey: row.id.slice(row.simplified.length + 1),
            level,
            frequency: row.frequency,
          }))
          .filter((word) => !carded.has(subjectId(word)) && !personal.has(subjectId(word)))
          .sort(byPriority),
      );
    }
    return ok(queue.slice(0, limit).map(subjectOf));
  });
