import { err, ok, type Result } from "@openlinguo/core";
import type { Database } from "./database.ts";
import { EXTENDED_INDEX, importExtendedLexicon } from "./extended-lexicon.ts";
import { OnDemandIndex } from "./format.ts";
import { readJson, type FetchFile, type ImportFailure, type ImportProgress } from "./import.ts";
import { importNames, NAMES_INDEX } from "./names.ts";

export type ListsFailure = ImportFailure | { readonly kind: "cancelled" };

/** `partial`: an interrupted download, or lists a new version of the app replaced. */
export type ListsState = "absent" | "partial" | "installed";

export type ListsStatus = {
  readonly state: ListsState;
  /** Both lists, as the app serves them; `null` when the app cannot be reached. */
  readonly bytes: number | null;
};

type List = { readonly index: string; readonly install: typeof importExtendedLexicon };

/** The extended lexicon (#52) and the name signal (#53): one download, both used by the panel. */
const LISTS: readonly List[] = [
  { index: EXTENDED_INDEX, install: importExtendedLexicon },
  { index: NAMES_INDEX, install: importNames },
];

/** What each list holds on this device, in the order of `LISTS`. */
const storedLists = async (
  db: Database,
): Promise<readonly { readonly version: string | null; readonly rows: number }[]> => [
  {
    version: (await db.extendedMeta.get("version"))?.value ?? null,
    rows: await db.extendedWords.count(),
  },
  { version: (await db.namesMeta.get("version"))?.value ?? null, rows: await db.names.count() },
];

const fetchIndex = async (
  fetchFile: FetchFile,
  file: string,
): Promise<Result<OnDemandIndex, ImportFailure>> => {
  const bytes = await fetchFile(file);
  if (!bytes.ok) return err({ kind: "network", file, message: bytes.error });
  return readJson(bytes.value, OnDemandIndex, file);
};

const sizeOf = ({ files }: OnDemandIndex): number =>
  files.reduce((sum, { bytes }) => sum + bytes, 0);

export const listsStatus = async (
  db: Database,
  fetchFile: FetchFile,
): Promise<Result<ListsStatus, ImportFailure>> => {
  const indexes = await Promise.all(LISTS.map(({ index }) => fetchIndex(fetchFile, index)));
  try {
    const stored = await storedLists(db);
    const installed = stored.every(
      ({ version }, at) =>
        version !== null && (indexes[at]?.ok !== true || indexes[at].value.version === version),
    );
    const sizes = indexes.map((index) => (index.ok ? sizeOf(index.value) : null));
    return ok({
      state: installed
        ? "installed"
        : stored.some(({ version, rows }) => version !== null || rows > 0)
          ? "partial"
          : "absent",
      bytes: sizes.every((size) => size !== null)
        ? sizes.reduce((sum, size) => sum + size, 0)
        : null,
    });
  } catch (error) {
    return err({ kind: "storage", file: "", message: String(error) });
  }
};

/**
 * Downloads both lists, one after the other, reporting the bytes done over the bytes of the two.
 * Cancelling stops at the next file; what is stored stays, and the next download resumes.
 */
export const installLists = async (
  db: Database,
  fetchFile: FetchFile,
  onProgress: (received: number, total: number) => void,
  signal: AbortSignal,
): Promise<Result<null, ListsFailure>> => {
  const sized: { readonly list: List; readonly size: number }[] = [];
  for (const list of LISTS) {
    const fetched = await fetchIndex(fetchFile, list.index);
    if (!fetched.ok) return fetched;
    sized.push({ list, size: sizeOf(fetched.value) });
  }
  const total = sized.reduce((sum, { size }) => sum + size, 0);
  const stoppable: FetchFile = (name) =>
    signal.aborted ? Promise.resolve(err("cancelled")) : fetchFile(name);
  let done = 0;
  for (const { list, size } of sized) {
    const result = await list.install(db, stoppable, ({ rows, total: count }: ImportProgress) => {
      onProgress(done + (count === 0 ? size : (size * rows) / count), total);
    });
    if (!result.ok) return signal.aborted ? err({ kind: "cancelled" }) : result;
    done += size;
    onProgress(done, total);
  }
  return ok(null);
};

/** Empties both lists; the panel then proposes nothing from them until they are downloaded again. */
export const removeLists = async (db: Database): Promise<Result<null, ImportFailure>> => {
  try {
    await db.transaction(
      "rw",
      [db.extendedWords, db.extendedMeta, db.names, db.namesMeta],
      async () => {
        await Promise.all([
          db.extendedWords.clear(),
          db.extendedMeta.clear(),
          db.names.clear(),
          db.namesMeta.clear(),
        ]);
      },
    );
    return ok(null);
  } catch (error) {
    return err({ kind: "storage", file: "", message: String(error) });
  }
};
