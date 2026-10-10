import { err, ok, type DictEntry, type LookupError, type Result } from "@openlinguo/core";
import {
  matchesPinyin,
  parsePinyinQuery,
  searchKey,
  type ZhProficiency,
} from "@openlinguo/lang-zh";
import type { Database, StoredEntry } from "./database.ts";
import { toDictEntry } from "./dictionary.ts";
import { idsFor, loadSearchIndex, type SearchIndex } from "./search-index.ts";
import { glossPhrase, indexedWords, latinWords } from "./search-keys.ts";

/** A gloss word this long or longer also finds the words it starts (`tele` → `telephone`). */
const MIN_WORD_PREFIX = 3;

const HAN = /\p{Script=Han}/u;

export type SearchResults = {
  /** Number of matching entries; `entries` holds the first ones. */
  readonly total: number;
  readonly entries: readonly DictEntry[];
};

type Match = { readonly entry: StoredEntry; readonly exact: boolean };

/** Words whose simplified or traditional form starts with the characters typed. */
const byCharacters = async (db: Database, text: string): Promise<Match[]> => {
  const rows = await db.entries
    .where("simplified")
    .startsWith(text)
    .or("variants")
    .startsWith(text)
    .toArray();
  return rows.map((entry) => ({
    entry,
    exact: entry.simplified === text || entry.variants.includes(text),
  }));
};

class MissingEntries extends Error {}

const entriesOf = async (db: Database, ids: ReadonlySet<string>): Promise<StoredEntry[]> => {
  const rows = await db.entries.bulkGet([...ids]);
  const entries = rows.filter((entry) => entry != null);
  if (entries.length !== rows.length) throw new MissingEntries();
  return entries;
};

/** Words whose pinyin starts with the letters typed, with the tones and syllable breaks typed. */
const byPinyin = async (db: Database, index: SearchIndex, text: string): Promise<Match[]> => {
  const query = parsePinyinQuery(text);
  if (query === null) return [];
  const entries = await entriesOf(db, idsFor(index.pinyin, query.key, true));
  return entries
    .filter((entry) => matchesPinyin(entry.reading, query))
    .map((entry) => ({ entry, exact: searchKey(entry.reading) === query.key }));
};

/**
 * Words with an English or French gloss holding every word typed, the last one possibly
 * unfinished; exact when a whole gloss is the query (`to call` for `call`).
 */
const byGloss = async (db: Database, index: SearchIndex, text: string): Promise<Match[]> => {
  const words = indexedWords(text);
  const last = words.at(-1) ?? null;
  if (last === null) return [];
  const typing = last === latinWords(text).at(-1) && last.length >= MIN_WORD_PREFIX;
  const complete = typing ? words.slice(0, -1) : words;
  const longest = complete.reduce((best, word) => (word.length > best.length ? word : best), "");
  const ids =
    longest === "" ? idsFor(index.words, last, true) : idsFor(index.words, longest, false);
  const entries = await entriesOf(db, ids);
  const phrase = glossPhrase(text);
  return entries.flatMap((entry) => {
    const glosses = entry.glosses.flat().filter((gloss) => {
      const glossWords = indexedWords(gloss);
      return (
        complete.every((word) => glossWords.includes(word)) &&
        (!typing || glossWords.some((word) => word.startsWith(last)))
      );
    });
    if (glosses.length === 0) return [];
    return [{ entry, exact: glosses.some((gloss) => glossPhrase(gloss) === phrase) }];
  });
};

/** Ascending, `null` last. */
const compareNullable = (a: number | null, b: number | null): number =>
  a === null || b === null ? Number(a === null) - Number(b === null) : a - b;

const negate = (value: number | null): number | null => (value === null ? null : -value);

const isProperNoun = (entry: StoredEntry): boolean => /^[A-Z]/u.test(entry.reading);

/**
 * Exact matches first, then by level in the referential, then by frequency; ties go to
 * CC-CEDICT words, common words before proper nouns, and shorter words.
 */
export const compareMatches =
  (referential: ZhProficiency) =>
  (a: Match, b: Match): number => {
    const level = (entry: StoredEntry): number | null =>
      referential === "hsk-2025" ? entry.hsk2025 : entry.gf0025;
    return (
      Number(b.exact) - Number(a.exact) ||
      compareNullable(level(a.entry), level(b.entry)) ||
      compareNullable(negate(a.entry.frequency), negate(b.entry.frequency)) ||
      Number(b.entry.lexicon) - Number(a.entry.lexicon) ||
      Number(isProperNoun(a.entry)) - Number(isProperNoun(b.entry)) ||
      Array.from(a.entry.simplified).length - Array.from(b.entry.simplified).length ||
      (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0)
    );
  };

/**
 * Searches the offline dictionary by Chinese characters (simplified or traditional), pinyin
 * with or without tones, or English and French glosses; returns the `limit` best entries.
 */
export const searchDictionary = async (
  db: Database,
  referential: ZhProficiency,
  text: string,
  limit: number,
): Promise<Result<SearchResults, LookupError>> => {
  const query = text.trim();
  if (query === "") return ok({ total: 0, entries: [] });
  try {
    let found: Match[];
    if (HAN.test(query)) {
      found = await byCharacters(db, query.replace(/\s/gu, ""));
    } else {
      const index = await loadSearchIndex(db);
      found = (await Promise.all([byPinyin(db, index, query), byGloss(db, index, query)])).flat();
    }
    const matches = new Map<string, Match>();
    for (const match of found) {
      if (matches.get(match.entry.id)?.exact !== true) matches.set(match.entry.id, match);
    }
    const ranked = [...matches.values()].sort(compareMatches(referential));
    return ok({
      total: ranked.length,
      entries: ranked.slice(0, limit).map(({ entry }) => toDictEntry(entry, referential)),
    });
  } catch (error) {
    if (error instanceof MissingEntries)
      return err({ kind: "dataset-missing", dataset: "entries" });
    return err({ kind: "storage-failure", message: String(error) });
  }
};
