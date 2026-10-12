import { err, ok, type LookupError, type Result } from "@openlinguo/core";
import { z } from "zod";
import type { Database, StoredExtendedWord } from "./database.ts";
import { ExtendedIndex, ExtendedRow, type ExtendedFile } from "./format.ts";
import {
  readJson,
  sha256,
  type FetchFile,
  type ImportFailure,
  type ImportProgress,
} from "./import.ts";

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
 * sequence. Each file is checked against its sha256 and stored in one transaction, so an
 * interrupted import resumes; the words of files a new version no longer lists are removed.
 * Offline, a complete import is used as it is.
 */
export const importExtendedLexicon = async (
  db: Database,
  fetchFile: FetchFile,
  onProgress: (progress: ImportProgress) => void,
): Promise<Result<null, ImportFailure>> => {
  const indexBytes = await fetchFile(EXTENDED_INDEX);
  if (!indexBytes.ok) {
    const failure: ImportFailure = {
      kind: "network",
      file: EXTENDED_INDEX,
      message: indexBytes.error,
    };
    try {
      return (await db.extendedMeta.get("version")) == null ? err(failure) : ok(null);
    } catch {
      return err(failure);
    }
  }
  const index = readJson(indexBytes.value, ExtendedIndex, EXTENDED_INDEX);
  if (!index.ok) return index;
  const { version, files } = index.value;
  const total = files.reduce((sum, file) => sum + file.rows, 0);

  let current = EXTENDED_INDEX;
  try {
    if ((await db.extendedMeta.get("version"))?.value === version) {
      onProgress({ rows: total, total });
      return ok(null);
    }
    await db.transaction("rw", [db.extendedWords, db.extendedMeta], async () => {
      await db.extendedMeta.delete("version");
      await db.extendedWords
        .where("file")
        .noneOf(files.map((file) => file.sha256))
        .delete();
    });
    let rows = 0;
    const pending: ExtendedFile[] = [];
    for (const file of files) {
      if ((await db.extendedWords.where("file").equals(file.sha256).first()) == null) {
        pending.push(file);
      } else rows += file.rows;
    }
    onProgress({ rows, total });

    for (const file of pending) {
      current = `${DIR}${file.name}`;
      const bytes = await fetchFile(current);
      if (!bytes.ok) return err({ kind: "network", file: current, message: bytes.error });
      if ((await sha256(bytes.value)) !== file.sha256) {
        return err({ kind: "integrity", file: current });
      }
      const words = readJson(bytes.value, z.array(ExtendedRow), current);
      if (!words.ok) return words;
      await db.transaction("rw", db.extendedWords, async () => {
        await db.extendedWords.bulkPut(words.value.map((row) => toStored(file.sha256, row)));
      });
      rows += file.rows;
      onProgress({ rows, total });
    }
    await db.extendedMeta.put({ key: "version", value: version });
    return ok(null);
  } catch (error) {
    return err({ kind: "storage", file: current, message: String(error) });
  }
};

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
