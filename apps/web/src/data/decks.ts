import {
  CardType,
  learningDay,
  newCards,
  ok,
  proficiencyFrameworks,
  replay,
  type CardKey,
  type Result,
} from "@openlinguo/core";
import type { ZhProficiency } from "@openlinguo/lang-zh";
import type { Database, StoredCard, StoredEntry } from "./database.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

/** One reading of a word: the cards of both types share it. */
export type WordKey = Pick<CardKey, "headword" | "readingKey">;

/** A time with the local offset it was read in, as reviews store it. */
export type LocalTime = { readonly at: number; readonly utcOffsetMinutes: number };

export const localNow = (): LocalTime => {
  const now = new Date();
  return { at: now.getTime(), utcOffsetMinutes: -now.getTimezoneOffset() };
};

export type DeckCounts = { readonly new: number; readonly learning: number; readonly due: number };

export type Decks = { readonly personal: DeckCounts; readonly bands: readonly DeckCounts[] };

const LEVEL = {
  "hsk-2025": "hsk2025",
  "gf0025-2021": "gf0025",
} as const satisfies Record<ZhProficiency, keyof StoredEntry>;

const entryId = ({ headword, readingKey }: WordKey): string => `${headword}\t${readingKey}`;

const cardIds = ({ headword, readingKey }: WordKey): string[] =>
  newCards("zh", headword, readingKey).map((card) => card.id);

/** Puts a reading's cards in my words; a reading removed before gets its progress back. */
export const addWord = (db: Database, word: WordKey): Promise<Result<null, ReviewLogFailure>> =>
  guarded(() =>
    db.transaction(
      "rw",
      [db.cards, db.reviews],
      async (): Promise<Result<null, ReviewLogFailure>> => {
        const cards: StoredCard[] = [];
        for (const card of newCards("zh", word.headword, word.readingKey)) {
          const state = replay(card.id, await db.reviews.where("cardId").equals(card.id).toArray());
          if (!state.ok) return state;
          cards.push({ ...card, ...state.value, personal: true });
        }
        await db.cards.bulkPut(cards);
        return ok(null);
      },
    ),
  );

/** Takes a reading's cards out of the queue; their reviews stay in the log. */
export const removeWord = (db: Database, word: WordKey): Promise<Result<null, ReviewLogFailure>> =>
  guarded(async () => {
    await db.cards.bulkDelete(cardIds(word));
    return ok(null);
  });

export const isPersonal = (
  db: Database,
  word: WordKey,
): Promise<Result<boolean, ReviewLogFailure>> =>
  guarded(async () =>
    ok((await db.cards.bulkGet(cardIds(word))).some((card) => card?.personal === true)),
  );

type Tally = { new: number; learning: number; due: number };

/** Started cards count until the end of the current learning day. */
const tally = (counts: Tally, card: StoredCard, now: LocalTime): void => {
  if (card.phase === "new") {
    counts.new += 1;
  } else if (
    card.due !== null &&
    learningDay(card.due, now.utcOffsetMinutes) <= learningDay(now.at, now.utcOffsetMinutes)
  ) {
    counts[card.phase === "review" ? "due" : "learning"] += 1;
  }
};

/** Card counts of my words and of each band, whose readings without cards count as new cards. */
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
    const personal: Tally = { new: 0, learning: 0, due: 0 };
    cards.forEach((card, index) => {
      if (card.personal) tally(personal, card, now);
      const level = entries[index]?.[field] ?? null;
      const band = level === null ? null : (bands[level - 1] ?? null);
      if (band === null) return;
      // The stored card replaces one of the band's virtual new cards.
      band.new -= 1;
      tally(band, card, now);
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

/** Readings to introduce next: my words, then the bands, each by level then frequency (Pareto). */
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
      cards
        .filter((card) => card.personal && !started.has(entryId(card)))
        .map((card) => [entryId(card), card] as const),
    );
    const entries = await db.entries.bulkGet([...personal.keys()]);
    const queue: Candidate[] = [...personal.values()]
      .map((card, index) => ({
        headword: card.headword,
        readingKey: card.readingKey,
        level: entries[index]?.[field] ?? null,
        frequency: entries[index]?.frequency ?? null,
      }))
      .sort(byPriority);
    const levels = proficiencyFrameworks[referential].length;
    for (let level = 1; level <= levels && queue.length < limit; level += 1) {
      const rows = await db.entries.where(field).equals(level).toArray();
      queue.push(
        ...rows
          .filter((row) => !carded.has(row.id))
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
