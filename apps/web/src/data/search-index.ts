import { searchKey } from "@openlinguo/lang-zh";
import type { Database } from "./database.ts";
import { indexedWords } from "./search-keys.ts";

/** Keys of one index, each with the positions of its entries in `ids`. */
type Postings = readonly (readonly [key: string, positions: readonly number[]])[];

/**
 * Search keys of one entries file, stored with its entries. Kept apart from the entries:
 * IndexedDB would write a multi-entry index of 737,000 gloss words three times slower.
 */
export type SearchIndexRecord = {
  /** sha256 of the entries file. */
  readonly file: string;
  /** Entry ids, in file order. */
  readonly ids: readonly string[];
  /** Toneless pinyin (`dianhua`). */
  readonly pinyin: Postings;
  /** Indexed words of the English and French glosses. */
  readonly words: Postings;
};

type IndexedEntry = {
  readonly id: string;
  readonly reading: string;
  readonly glosses: readonly (readonly string[])[];
};

const toPostings = (positions: ReadonlyMap<string, readonly number[]>): Postings =>
  [...positions].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

export const indexRecord = (file: string, entries: readonly IndexedEntry[]): SearchIndexRecord => {
  const pinyin = new Map<string, number[]>();
  const words = new Map<string, number[]>();
  const add = (postings: Map<string, number[]>, key: string, position: number): void => {
    const positions = postings.get(key) ?? null;
    if (positions === null) postings.set(key, [position]);
    else if (positions.at(-1) !== position) positions.push(position);
  };
  for (const [position, entry] of entries.entries()) {
    add(pinyin, searchKey(entry.reading), position);
    for (const word of entry.glosses.flat().flatMap(indexedWords)) add(words, word, position);
  }
  return {
    file,
    ids: entries.map((entry) => entry.id),
    pinyin: toPostings(pinyin),
    words: toPostings(words),
  };
};

/** Merged keys, sorted for prefix search, each with the ids of its entries. */
export type KeyIndex = {
  readonly keys: readonly string[];
  readonly ids: ReadonlyMap<string, readonly string[]>;
};

export type SearchIndex = { readonly pinyin: KeyIndex; readonly words: KeyIndex };

const merge = (
  records: readonly SearchIndexRecord[],
  postingsOf: (record: SearchIndexRecord) => Postings,
): KeyIndex => {
  const ids = new Map<string, string[]>();
  for (const record of records) {
    for (const [key, positions] of postingsOf(record)) {
      const merged = ids.get(key) ?? [];
      for (const position of positions) merged.push(record.ids[position] ?? "");
      ids.set(key, merged);
    }
  }
  return { keys: [...ids.keys()].sort(), ids };
};

/** Ids of the entries under `key`, or under every key it starts when `prefix` is set. */
export const idsFor = (index: KeyIndex, key: string, prefix: boolean): ReadonlySet<string> => {
  if (!prefix) return new Set(index.ids.get(key) ?? []);
  let low = 0;
  let high = index.keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((index.keys[middle] ?? "") < key) low = middle + 1;
    else high = middle;
  }
  const found = new Set<string>();
  for (let position = low; index.keys[position]?.startsWith(key) === true; position++) {
    for (const id of index.ids.get(index.keys[position] ?? "") ?? []) found.add(id);
  }
  return found;
};

const loaded = new WeakMap<
  Database,
  { readonly version: string; readonly index: Promise<SearchIndex> }
>();

/** The merged search index of the imported data, read once per data version. */
export const loadSearchIndex = async (db: Database): Promise<SearchIndex> => {
  const version = (await db.meta.get("dataVersion"))?.value ?? null;
  if (typeof version !== "string") throw new Error("the dictionary is not imported");
  const cached = loaded.get(db);
  if (cached?.version === version) return cached.index;
  const index = db.searchIndex.toArray().then((records) => ({
    pinyin: merge(records, (record) => record.pinyin),
    words: merge(records, (record) => record.words),
  }));
  loaded.set(db, { version, index });
  // A failed read is tried again on the next search.
  void index.catch(() => {
    if (loaded.get(db)?.index === index) loaded.delete(db);
  });
  return index;
};
