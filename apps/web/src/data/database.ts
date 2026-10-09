import { Dexie, type EntityTable } from "dexie";

export type StoredEntry = {
  /** `simplified \t reading key` */
  readonly id: string;
  readonly simplified: string;
  readonly reading: string;
  readonly variants: readonly string[];
  /** Glosses per source, in `GLOSS_SOURCES` order. */
  readonly glosses: readonly [readonly string[], readonly string[], readonly string[]];
  readonly hsk2025: number | null;
  readonly gf0025: number | null;
  /** CC-CEDICT headword, used for segmentation; French-only words are not. */
  readonly lexicon: boolean;
};

export type StoredCharacter = {
  readonly character: string;
  readonly decomposition: string;
  readonly radical: string;
  readonly etymology: {
    readonly type: string;
    readonly hint: string | null;
    readonly phonetic: string | null;
    readonly semantic: string | null;
  } | null;
};

export type MetaRecord =
  | { readonly key: "dataVersion" | "importingVersion"; readonly value: string }
  | { readonly key: "lexicon"; readonly value: readonly string[] };

/** A data file fully imported, by content hash. */
export type ImportRecord = { readonly sha256: string };

export type Database = Dexie & {
  entries: EntityTable<StoredEntry, "id">;
  characters: EntityTable<StoredCharacter, "character">;
  meta: EntityTable<MetaRecord, "key">;
  imports: EntityTable<ImportRecord, "sha256">;
};

export const openDatabase = (name: string): Database => {
  const db = new Dexie(name) as Database;
  db.version(1).stores({
    entries: "id, simplified, *variants",
    characters: "character",
    meta: "key",
    imports: "sha256",
  });
  return db;
};

export const database = openDatabase("openlinguo");
