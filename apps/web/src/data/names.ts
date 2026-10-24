import { err, ok, type LookupError, type Result } from "@openlinguo/core";
import type { Database, StoredName } from "./database.ts";
import { NameRow, type NameKind } from "./format.ts";
import type { FetchFile, ImportFailure, ImportProgress } from "./import.ts";
import { importOnDemand } from "./on-demand.ts";

const DIR = "jieba-names/";
export const NAMES_INDEX = `${DIR}index.json`;

const toStored = (file: string, [word, kind]: NameRow): StoredName => ({
  id: `${word}\t${kind}`,
  file,
  word,
  kind,
});

/**
 * Imports the proper names of jieba's dictionary that no shipped lexicon has into IndexedDB. Like
 * the extended lexicon, it is not part of the first-run import: the reader calls it before it
 * first explains an unknown sequence.
 */
export const importNames = (
  db: Database,
  fetchFile: FetchFile,
  onProgress: (progress: ImportProgress) => void,
): Promise<Result<null, ImportFailure>> =>
  importOnDemand(
    { dir: DIR, row: NameRow, rows: db.names, meta: db.namesMeta, toStored },
    fetchFile,
    onProgress,
  );

/**
 * What jieba's tags propose this exact sequence is, after an import: never a fact, it gives no
 * meaning and is wrong for about one name in eight (see `data/jieba-names/README.md`).
 */
export const lookupNameKinds = async (
  db: Database,
  sequence: string,
): Promise<Result<readonly NameKind[], LookupError>> => {
  try {
    const names = await db.names.where("word").equals(sequence).toArray();
    return ok(names.map(({ kind }) => kind));
  } catch (error) {
    return err({ kind: "storage-failure", message: String(error) });
  }
};

/** The label of a proposal: « Nom de personne probable », "Probable place name"… */
export const nameProposalKey = (kind: NameKind) => `nameProposal.${kind}` as const;
