import { z } from "zod";

export const SYNC_LIMITS = {
  chunkBytes: 262144,
  accountBytes: 10485760,
  chunksPerHour: 120,
  databaseBytes: 400000000,
} as const;

export const SYNC_HEADERS = {
  id: "x-sync-chunk-id",
  oldest: "x-sync-oldest",
  /** On the answer with no chunk: its sum reads every chunk row of the account. */
  used: "x-sync-used",
  /** On a push: the oldest chunk the device remembers, refused if the store no longer starts there. */
  expectedOldest: "x-sync-expected-oldest",
} as const;

/** What an account stores: `oldest` is its first chunk's id, `null` when it has none. */
export const SyncUsage = z.object({
  used: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  oldest: z.number().int().positive().nullable(),
});
export type SyncUsage = z.output<typeof SyncUsage>;

export const StoredChunk = SyncUsage.extend({ id: z.number().int().positive() });
export type StoredChunk = z.output<typeof StoredChunk>;
