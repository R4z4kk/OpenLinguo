import { err, ok, type LookupError, type Result } from "@openlinguo/core";
import type { Database, StoredExtendedWord } from "./database.ts";
import { ExtendedRow } from "./format.ts";
import type { FetchFile, ImportFailure, ImportProgress } from "./import.ts";
import { importOnDemand } from "./on-demand.ts";

const DIR = "wiktionary-zh/";
export const EXTENDED_INDEX = `${DIR}index.json`;

export type ExtendedWord = Omit<StoredExtendedWord, "id" | "file">;

const toStored = (
  file: string,
  [simplified, traditional, reading, pos, glosses]: ExtendedRow,
): StoredExtendedWord => ({
  id: [simplified, traditional, reading, pos].join("\t"),
  file,
  simplified,
  traditional,
  reading,
  pos,
  glosses,
});

/**
 * Imports the extended lexicon (English Wiktionary words CC-CEDICT lacks) into IndexedDB. It is
 * not part of the first-run import: the reader calls it before its first lookup of an unknown
 * sequence (same checks, resume and offline use as `importOnDemand`).
 */
export const importExtendedLexicon = (
  db: Database,
  fetchFile: FetchFile,
  onProgress: (progress: ImportProgress) => void,
): Promise<Result<null, ImportFailure>> =>
  importOnDemand(
    { dir: DIR, row: ExtendedRow, rows: db.extendedWords, meta: db.extendedMeta, toStored },
    fetchFile,
    onProgress,
  );

/** Extended lexicon words written with exactly this simplified sequence, after an import. */
export const lookupExtended = async (
  db: Database,
  sequence: string,
): Promise<Result<readonly ExtendedWord[], LookupError>> => {
  try {
    const words = await db.extendedWords.where("simplified").equals(sequence).toArray();
    return ok(
      words.map(({ simplified, traditional, reading, pos, glosses }) => ({
        simplified,
        traditional,
        reading,
        pos,
        glosses,
      })),
    );
  } catch (error) {
    return err({ kind: "storage-failure", message: String(error) });
  }
};
