import { err, ok, subjectId, type DictEntry, type Result, type WordKey } from "@openlinguo/core";
import type { ZhProficiency } from "@openlinguo/lang-zh";
import { z } from "zod";
import { readStored, writeStored } from "@/lib/stored";
import type { Database, StoredEntry } from "./database.ts";
import type { DeckCounts } from "./decks.ts";
import { toDictEntry } from "./dictionary.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

export const THEMES = [
  "cooking",
  "travel",
  "nature",
  "sport",
  "music",
  "cinema",
  "technology",
  "work",
  "family",
  "art",
] as const;

export const NOTE_MAX = 120;

/** Headwords asked for per call. */
export const SUGGESTION_COUNT = 10;

/** On the device and in the backup, never synced (docs/compliance/data-map.md). */
export const Interests = z.object({
  themes: z.array(z.enum(THEMES)),
  note: z.string().max(NOTE_MAX),
});
export type Interests = z.output<typeof Interests>;

export const NO_INTERESTS: Interests = { themes: [], note: "" };

const STORAGE_KEY = "openlinguo.interests";

export const loadInterests = (
  storage: () => Pick<Storage, "getItem">,
): Result<Interests, string> => {
  const stored = readStored(storage, STORAGE_KEY);
  if (!stored.ok) return stored;
  if (stored.value === null) return ok(NO_INTERESTS);
  try {
    const json: unknown = JSON.parse(stored.value);
    const parsed = Interests.safeParse(json);
    return parsed.success ? ok(parsed.data) : err(z.prettifyError(parsed.error));
  } catch (error) {
    return err(String(error));
  }
};

export const saveInterests = (
  storage: () => Pick<Storage, "setItem">,
  interests: Interests,
): Result<null, string> => writeStored(storage, STORAGE_KEY, JSON.stringify(interests));

/** The band being learned, 1-based: the first with new cards left, else the last. */
export const learningBand = (bands: readonly DeckCounts[]): number => {
  const index = bands.findIndex((band) => band.new > 0);
  return index === -1 ? bands.length : index + 1;
};

export type Suggestion = { readonly word: WordKey; readonly entry: DictEntry };

/** `dropped`: the distinct headwords not kept. */
export type Suggestions = { readonly words: readonly Suggestion[]; readonly dropped: number };

/**
 * Keeps each distinct headword that is a dictionary entry with no reading started, with the
 * dictionary's reading taught first (ungraded ones in dictionary order, as on the word page).
 */
export const keepSuggestions = (
  headwords: readonly string[],
  entriesOf: ReadonlyMap<string, readonly StoredEntry[]>,
  started: ReadonlySet<string>,
  referential: ZhProficiency,
): Suggestions => {
  const distinct = [...new Set(headwords)];
  const words = distinct.flatMap((headword): Suggestion[] => {
    const readings = (entriesOf.get(headword) ?? []).map((row) => ({
      word: { headword, readingKey: row.id.slice(headword.length + 1) },
      entry: toDictEntry(row, referential),
    }));
    if (readings.some(({ word }) => started.has(subjectId(word)))) return [];
    const [first] = readings.toSorted(
      (a, b) =>
        (a.entry.level ?? Number.MAX_SAFE_INTEGER) - (b.entry.level ?? Number.MAX_SAFE_INTEGER),
    );
    return first == null ? [] : [first];
  });
  return { words, dropped: distinct.length - words.length };
};

/** The AI's headwords checked against the dictionary and the cards the learner started. */
export const checkSuggestions = (
  db: Database,
  headwords: readonly string[],
  referential: ZhProficiency,
): Promise<Result<Suggestions, ReviewLogFailure>> =>
  guarded(() =>
    db.transaction("r", [db.entries, db.cards], async () => {
      const distinct = [...new Set(headwords)];
      // One `equals` per key: `anyOf` walks the whole index in WebKit.
      const rows = await Promise.all(
        distinct.map((headword) => db.entries.where("simplified").equals(headword).toArray()),
      );
      const cards = await db.cards.toArray();
      const started = new Set(cards.filter((card) => card.phase !== "new").map(subjectId));
      const entriesOf = new Map(distinct.map((headword, index) => [headword, rows[index] ?? []]));
      return ok(keepSuggestions(distinct, entriesOf, started, referential));
    }),
  );
