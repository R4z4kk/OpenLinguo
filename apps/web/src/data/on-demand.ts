import { err, ok, type Result } from "@openlinguo/core";
import type { EntityTable, Table } from "dexie";
import { z } from "zod";
import type { OnDemandMetaRecord } from "./database.ts";
import { OnDemandIndex, type OnDemandFile } from "./format.ts";
import {
  readJson,
  sha256,
  type FetchFile,
  type ImportFailure,
  type ImportProgress,
} from "./import.ts";

/** A dataset packed apart in `public/data/<dir>` with its own `index.json`. */
export type OnDemandDataset<Row, Stored extends { readonly file: string }> = {
  /** `wiktionary-zh/` */
  readonly dir: string;
  readonly row: z.ZodType<Row>;
  readonly rows: Table<Stored, string>;
  /** Kept apart from `meta`, which a new dictionary version clears. */
  readonly meta: EntityTable<OnDemandMetaRecord, "key">;
  /** `file` is the sha256 of the file the row was imported from. */
  readonly toStored: (file: string, row: Row) => Stored;
};

/**
 * Imports a dataset that is not part of the first-run import into IndexedDB, when a feature first
 * needs it. Each file is checked against its sha256 and stored in one transaction, so an
 * interrupted import resumes; the rows of files a new version no longer lists are removed.
 * Offline, a complete import is used as it is.
 */
export const importOnDemand = async <Row, Stored extends { readonly file: string }>(
  dataset: OnDemandDataset<Row, Stored>,
  fetchFile: FetchFile,
  onProgress: (progress: ImportProgress) => void,
): Promise<Result<null, ImportFailure>> => {
  const { dir, row, rows: table, meta, toStored } = dataset;
  const indexFile = `${dir}index.json`;
  const indexBytes = await fetchFile(indexFile);
  if (!indexBytes.ok) {
    const failure: ImportFailure = { kind: "network", file: indexFile, message: indexBytes.error };
    try {
      return (await meta.get("version")) == null ? err(failure) : ok(null);
    } catch {
      return err(failure);
    }
  }
  const index = readJson(indexBytes.value, OnDemandIndex, indexFile);
  if (!index.ok) return index;
  const { version, files } = index.value;
  const total = files.reduce((sum, file) => sum + file.rows, 0);

  let current = indexFile;
  try {
    if ((await meta.get("version"))?.value === version) {
      onProgress({ rows: total, total });
      return ok(null);
    }
    await table.db.transaction("rw", [table, meta], async () => {
      await meta.delete("version");
      await table
        .where("file")
        .noneOf(files.map((file) => file.sha256))
        .delete();
    });
    let imported = 0;
    const pending: OnDemandFile[] = [];
    for (const file of files) {
      if ((await table.where("file").equals(file.sha256).first()) == null) pending.push(file);
      else imported += file.rows;
    }
    onProgress({ rows: imported, total });

    for (const file of pending) {
      current = `${dir}${file.name}`;
      const bytes = await fetchFile(current);
      if (!bytes.ok) return err({ kind: "network", file: current, message: bytes.error });
      if ((await sha256(bytes.value)) !== file.sha256) {
        return err({ kind: "integrity", file: current });
      }
      const parsed = readJson(bytes.value, z.array(row), current);
      if (!parsed.ok) return parsed;
      await table.db.transaction("rw", table, async () => {
        await table.bulkPut(parsed.value.map((value) => toStored(file.sha256, value)));
      });
      imported += file.rows;
      onProgress({ rows: imported, total });
    }
    await meta.put({ key: "version", value: version });
    return ok(null);
  } catch (error) {
    return err({ kind: "storage", file: current, message: String(error) });
  }
};
