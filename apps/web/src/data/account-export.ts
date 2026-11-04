import { err, ok, type Result } from "@openlinguo/core";
import type { AccountExport } from "@openlinguo/core/account";
import { exportAccount } from "./account.ts";
import { decodeChunk, type SyncChunk } from "./sync-chunk.ts";
import { nextChunk } from "./sync-client.ts";
import type { SyncFailure } from "./sync.ts";

export type AccountExportFile = AccountExport & { readonly synced: readonly SyncChunk[] };

/** What reading the account's chunks can fail with. */
export type ExportFailure = Extract<
  SyncFailure,
  { kind: "api" | "unreadable-chunk" | "newer-format" | "unavailable" }
>;

/** Every chunk the account stores, decoded here so the server decodes nothing (ADR 0016). */
export const exportSyncedData = async (): Promise<Result<readonly SyncChunk[], ExportFailure>> => {
  if (typeof DecompressionStream === "undefined") return err({ kind: "unavailable" });
  const chunks: SyncChunk[] = [];
  let cursor = 0;
  for (;;) {
    const next = await nextChunk(cursor);
    if (!next.ok) return err({ kind: "api", failure: next.error });
    const { id, bytes } = next.value;
    if (id === null) return ok(chunks);
    if (id <= cursor) return err({ kind: "api", failure: { kind: "unexpected", status: 200 } });
    const decoded = await decodeChunk(bytes);
    if (!decoded.ok)
      return err(
        decoded.error.kind === "newer-format"
          ? { kind: "newer-format", version: decoded.error.version }
          : { kind: "unreadable-chunk", chunkId: id },
      );
    chunks.push(decoded.value);
    cursor = id;
  }
};

/** The account export with the synced chunks: either all of it, or an error and no file. */
export const exportAccountFile = async (): Promise<Result<AccountExportFile, ExportFailure>> => {
  const account = await exportAccount();
  if (!account.ok) return err({ kind: "api", failure: account.error });
  const synced = await exportSyncedData();
  return synced.ok ? ok({ ...account.value, synced: synced.value }) : synced;
};
