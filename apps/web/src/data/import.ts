import { err, ok, parseWith, type Result } from "@openlinguo/core";
import { z } from "zod";
import type { Database, StoredCharacter, StoredEntry } from "./database.ts";
import { CharacterRow, DataIndex, EntryRow, Lexicon, type DataFile } from "./format.ts";
import { indexRecord } from "./search-index.ts";

export type ImportProgress = { readonly rows: number; readonly total: number };

export type ImportFailure =
  | { readonly kind: "network"; readonly file: string; readonly message: string }
  | { readonly kind: "integrity"; readonly file: string }
  | { readonly kind: "format"; readonly file: string; readonly message: string }
  | { readonly kind: "storage"; readonly file: string; readonly message: string };

export type FetchFile = (name: string) => Promise<Result<Uint8Array<ArrayBuffer>, string>>;

export const fetchDataFile: FetchFile = async (name) => {
  try {
    const response = await fetch(`/data/${name}`, { cache: "no-store" });
    if (!response.ok) return err(`HTTP ${String(response.status)}`);
    return ok(new Uint8Array(await response.arrayBuffer()));
  } catch (error) {
    return err(String(error));
  }
};

const sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

const readJson = <S extends z.ZodType>(
  bytes: Uint8Array,
  schema: S,
  file: string,
): Result<z.output<S>, ImportFailure> => {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    return err({ kind: "format", file, message: String(error) });
  }
  const parsed = parseWith(schema, json);
  if (parsed.ok) return parsed;
  const [issue] = parsed.error.issues;
  return err({ kind: "format", file, message: `${issue?.path ?? ""}: ${issue?.message ?? ""}` });
};

const toEntry = ([
  simplified,
  key,
  reading,
  variants,
  glosses,
  hsk2025,
  gf0025,
  lexicon,
  frequency,
]: EntryRow): StoredEntry => ({
  id: `${simplified}\t${key}`,
  simplified,
  reading,
  variants,
  glosses,
  hsk2025,
  gf0025,
  lexicon,
  frequency,
});

const toCharacter = ([
  character,
  decomposition,
  radical,
  etymology,
]: CharacterRow): StoredCharacter => ({
  character,
  decomposition,
  radical,
  etymology,
});

const store = async (
  db: Database,
  file: DataFile,
  bytes: Uint8Array,
): Promise<Result<null, ImportFailure>> => {
  const tables = [db.entries, db.characters, db.meta, db.imports, db.searchIndex];
  if (file.kind === "entries") {
    const rows = readJson(bytes, z.array(EntryRow), file.name);
    if (!rows.ok) return rows;
    const entries = rows.value.map(toEntry);
    await db.transaction("rw", tables, async () => {
      await db.entries.bulkPut(entries);
      await db.searchIndex.put(indexRecord(file.sha256, entries));
      await db.imports.put({ sha256: file.sha256 });
    });
  } else if (file.kind === "characters") {
    const rows = readJson(bytes, z.array(CharacterRow), file.name);
    if (!rows.ok) return rows;
    await db.transaction("rw", tables, async () => {
      await db.characters.bulkPut(rows.value.map(toCharacter));
      await db.imports.put({ sha256: file.sha256 });
    });
  } else {
    const lexicon = readJson(bytes, Lexicon, file.name);
    if (!lexicon.ok) return lexicon;
    await db.transaction("rw", tables, async () => {
      await db.meta.put({ key: "lexicon", value: lexicon.value });
      await db.imports.put({ sha256: file.sha256 });
    });
  }
  return ok(null);
};

/**
 * Imports `data/index.json` and its files into IndexedDB. Each file is checked against its
 * sha256 and stored in one transaction, so an interrupted import resumes where it stopped;
 * a new data version replaces the old one. Offline, a complete import is used as it is.
 */
export const importData = async (
  db: Database,
  fetchFile: FetchFile,
  onProgress: (progress: ImportProgress) => void,
): Promise<Result<null, ImportFailure>> => {
  const indexBytes = await fetchFile("index.json");
  if (!indexBytes.ok) {
    const failure: ImportFailure = {
      kind: "network",
      file: "index.json",
      message: indexBytes.error,
    };
    try {
      return (await db.meta.get("dataVersion")) == null ? err(failure) : ok(null);
    } catch {
      return err(failure);
    }
  }
  const index = readJson(indexBytes.value, DataIndex, "index.json");
  if (!index.ok) return index;
  const total = index.value.files.reduce((sum, file) => sum + file.rows, 0);

  let current = "index.json";
  try {
    const imported = await db.meta.get("dataVersion");
    if (imported?.value === index.value.version) {
      onProgress({ rows: total, total });
      return ok(null);
    }
    const importing = await db.meta.get("importingVersion");
    if (importing?.value !== index.value.version) {
      const tables = [db.entries, db.characters, db.meta, db.imports, db.searchIndex];
      await db.transaction("rw", tables, async () => {
        await Promise.all(tables.map((table) => table.clear()));
        await db.meta.put({ key: "importingVersion", value: index.value.version });
      });
    }
    const done = new Set((await db.imports.toArray()).map((record) => record.sha256));
    let rows = index.value.files
      .filter((file) => done.has(file.sha256))
      .reduce((sum, file) => sum + file.rows, 0);
    onProgress({ rows, total });

    for (const file of index.value.files) {
      if (done.has(file.sha256)) continue;
      current = file.name;
      const bytes = await fetchFile(file.name);
      if (!bytes.ok) return err({ kind: "network", file: file.name, message: bytes.error });
      if ((await sha256(bytes.value)) !== file.sha256)
        return err({ kind: "integrity", file: file.name });
      const stored = await store(db, file, bytes.value);
      if (!stored.ok) return stored;
      rows += file.rows;
      onProgress({ rows, total });
    }
    await db.meta.put({ key: "dataVersion", value: index.value.version });
    return ok(null);
  } catch (error) {
    return err({ kind: "storage", file: current, message: String(error) });
  }
};
