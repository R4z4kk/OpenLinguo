import { cardKey, err, ok, type Result } from "@openlinguo/core";
import { SYNC_LIMITS, type SyncUsage } from "@openlinguo/core/sync";
import type { ApiFailure } from "./api.ts";
import type { Database, SyncState } from "./database.ts";
import { deleteStore, nextChunk, pushChunk } from "./sync-client.ts";
import {
  decodeChunk,
  encodeChunk,
  parseDeckWordId,
  parseKnownMarkKey,
  SYNC_FORMAT,
  SYNC_VERSION,
  SyncChunk,
} from "./sync-chunk.ts";
import { clearEntities, markAllWaiting, SYNCED_TABLES, type SyncEntity } from "./sync-entities.ts";
import { applyChunk } from "./sync-merge.ts";

export type SyncFailure =
  | { readonly kind: "api"; readonly failure: ApiFailure }
  | { readonly kind: "unreadable-chunk"; readonly chunkId: number }
  | { readonly kind: "newer-format"; readonly version: number }
  | { readonly kind: "turned-off-elsewhere" }
  | { readonly kind: "other-account" }
  | { readonly kind: "entity-too-large"; readonly entityId: string }
  | { readonly kind: "unavailable" }
  | { readonly kind: "storage"; readonly message: string }
  /** Another tab holds the lock: it is syncing, so nothing is done here. */
  | { readonly kind: "busy" };

export const SYNC_MIN_INTERVAL_MS = 300_000;

const LOCK = "openlinguo-sync";
const BATCH = 500;

const storage = (message: string): SyncFailure => ({ kind: "storage", message });

const supported = (): boolean =>
  typeof CompressionStream !== "undefined" &&
  typeof DecompressionStream !== "undefined" &&
  typeof navigator !== "undefined" &&
  typeof navigator.locks !== "undefined";

/** One tab at a time: a second one would send the same rows. */
const exclusive = async <T>(
  run: () => Promise<Result<T, SyncFailure>>,
  wait: boolean,
): Promise<Result<T, SyncFailure>> => {
  if (!supported()) return err({ kind: "unavailable" });
  try {
    return await navigator.locks.request(
      LOCK,
      { ifAvailable: !wait },
      async (lock): Promise<Result<T, SyncFailure>> =>
        lock === null ? err({ kind: "busy" }) : run(),
    );
  } catch (error) {
    return err(storage(String(error)));
  }
};

/** A waiting row with the value it sends: nothing for a deletion. */
type Item = { readonly row: SyncEntity; readonly value: unknown };

/** What a row sends, `null` when it has no value to send. */
const valueOf = async (
  db: Database,
  { table, key }: SyncEntity,
): Promise<{ value: unknown } | null> => {
  switch (table) {
    case "reviews": {
      const review = await db.reviews.get(key);
      return review == null ? null : { value: review };
    }
    // Cards and deck words are their key: a word gone with its deck still has one.
    case "cards": {
      const parts = cardKey(key);
      return { value: parts === null ? null : { ...parts, id: key } };
    }
    case "deckWords": {
      const parts = parseDeckWordId(key);
      return { value: parts === null ? null : { deckId: parts.deckId, ...parts.subject } };
    }
    case "decks": {
      const deck = await db.decks.get(key);
      return deck == null ? null : { value: deck };
    }
    case "notes": {
      const note = await db.notes.get(key);
      return note == null ? null : { value: note };
    }
    case "knownMarks": {
      try {
        const mark = await db.knownMarks.get(parseKnownMarkKey(key));
        return mark == null ? null : { value: mark };
      } catch {
        return { value: null };
      }
    }
  }
};

/** A deck word goes no later than a note: the merge refuses a note's deletion while a word files it. */
const rank = ({ table }: SyncEntity): number => (table === "deckWords" ? 0 : 1);

type Waiting = { readonly items: readonly Item[]; readonly empty: readonly SyncEntity[] };

/**
 * The waiting rows with their current values, in one read. A live row with no stored value is
 * kept apart and sends nothing: a card and a deck word are their key, so never in that case, and
 * the other tables delete through their hooks, so none is expected (a review is never deleted).
 */
const waiting = (db: Database): Promise<Waiting> =>
  db.transaction(
    "r",
    [db.syncEntities, db.reviews, db.decks, db.notes, db.knownMarks],
    async () => {
      const rows = (await db.syncEntities.where("pending").equals(1).toArray()).sort(
        (a, b) => rank(a) - rank(b),
      );
      const items: Item[] = [];
      const empty: SyncEntity[] = [];
      for (const row of rows) {
        if (row.deleted) {
          items.push({ row, value: null });
          continue;
        }
        const found = await valueOf(db, row);
        if (found === null) empty.push(row);
        else items.push({ row, value: found.value });
      }
      return { items, empty };
    },
  );

const chunkOf = (items: readonly Item[]): unknown => ({
  format: SYNC_FORMAT,
  version: SYNC_VERSION,
  reviews: items.filter(({ row }) => row.table === "reviews").map(({ value }) => value),
  entities: items
    .filter(({ row }) => row.table !== "reviews")
    .map(({ row, value }) => ({
      table: row.table,
      key: row.key,
      changedAt: row.changedAt,
      deleted: row.deleted,
      value,
    })),
});

/** The chunk of a batch, validated: a row the other devices would refuse must not leave. */
const validated = (items: readonly Item[]): Result<SyncChunk, SyncFailure> => {
  const parsed = SyncChunk.safeParse(chunkOf(items));
  if (parsed.success) return ok(parsed.data);
  const [list, index] = parsed.error.issues[0]?.path ?? [];
  const row =
    typeof index === "number"
      ? items.filter(({ row: { table } }) => (table === "reviews") === (list === "reviews"))[index]
          ?.row
      : null;
  return err(storage(`Invalid sync row ${row?.id ?? "of a chunk"}`));
};

type Planned = { readonly items: readonly Item[]; readonly bytes: Uint8Array };

/** Halves a batch until each part fits a chunk, keeping the order. */
const fit = async (items: readonly Item[]): Promise<Result<Planned[], SyncFailure>> => {
  const chunk = validated(items);
  if (!chunk.ok) return chunk;
  const bytes = await encodeChunk(chunk.value);
  if (bytes.length <= SYNC_LIMITS.chunkBytes) return ok([{ items, bytes }]);
  const only = items[0] ?? null;
  if (items.length === 1 && only !== null)
    return err({ kind: "entity-too-large", entityId: only.row.id });
  const middle = Math.ceil(items.length / 2);
  const first = await fit(items.slice(0, middle));
  if (!first.ok) return first;
  const second = await fit(items.slice(middle));
  return second.ok ? ok([...first.value, ...second.value]) : second;
};

/** Every chunk is made before any is sent, so a row that cannot go leaves everything waiting. */
const plan = async (items: readonly Item[]): Promise<Result<Planned[], SyncFailure>> => {
  const planned: Planned[] = [];
  for (let start = 0; start < items.length; start += BATCH) {
    const batch = await fit(items.slice(start, start + BATCH));
    if (!batch.ok) return batch;
    planned.push(...batch.value);
  }
  return ok(planned);
};

/** Marks sent what was sent, unless it changed meanwhile: a review's row goes, another's stops waiting. */
const markSent = (
  db: Database,
  sent: readonly SyncEntity[],
  oldest: number | null,
): Promise<void> =>
  db.transaction("rw", [db.syncEntities, db.syncState], async () => {
    const current = await db.syncEntities.bulkGet(sent.map(({ id }) => id));
    const unchanged = sent.filter((row, index) => {
      const now = current[index];
      return now != null && now.changedAt === row.changedAt && now.deleted === row.deleted;
    });
    await db.syncEntities.bulkDelete(
      unchanged.filter(({ table }) => table === "reviews").map(({ id }) => id),
    );
    await db.syncEntities.bulkUpdate(
      unchanged
        .filter(({ table }) => table !== "reviews")
        .map(({ id }) => ({ key: id, changes: { pending: 0 } })),
    );
    if (oldest !== null) await db.syncState.update("state", { oldest });
  });

const apiFailure = (failure: ApiFailure): SyncFailure => ({ kind: "api", failure });

const run = async (db: Database, accountId: string): Promise<Result<SyncUsage, SyncFailure>> => {
  const state = await db.syncState.get("state");
  if (state == null) return err(storage("Sync is off on this device"));
  if (state.accountId !== accountId) return err({ kind: "other-account" });
  let oldest = state.oldest;
  let cursor = state.cursor;
  let used: number;

  for (;;) {
    const next = await nextChunk(cursor);
    if (!next.ok) return err(apiFailure(next.error));
    used = next.value.used;
    if (oldest !== null && next.value.oldest !== oldest)
      return err({ kind: "turned-off-elsewhere" });
    if (oldest === null && next.value.oldest !== null) {
      oldest = next.value.oldest;
      await db.syncState.update("state", { oldest });
    }
    const { id, bytes } = next.value;
    if (id === null || bytes === null) break;
    if (id <= cursor) return err(apiFailure({ kind: "unexpected", status: 200 }));
    const decoded = await decodeChunk(bytes);
    if (!decoded.ok)
      return err(
        decoded.error.kind === "newer-format"
          ? { kind: "newer-format", version: decoded.error.version }
          : { kind: "unreadable-chunk", chunkId: id },
      );
    const applied = await applyChunk(db, decoded.value, id);
    if (!applied.ok)
      return err(
        applied.error.kind === "storage"
          ? storage(applied.error.message)
          : { kind: "unreadable-chunk", chunkId: id },
      );
    cursor = id;
  }

  const { items, empty } = await waiting(db);
  const planned = await plan(items);
  if (!planned.ok) return planned;
  await markSent(db, empty, null);
  let usage: SyncUsage = { used, limit: SYNC_LIMITS.accountBytes, oldest };
  for (const { items: batch, bytes } of planned.value) {
    const stored = await pushChunk(bytes);
    if (!stored.ok) return err(apiFailure(stored.error));
    if (oldest !== null && stored.value.oldest !== oldest)
      return err({ kind: "turned-off-elsewhere" });
    oldest = stored.value.oldest;
    usage = { used: stored.value.used, limit: stored.value.limit, oldest };
    await markSent(
      db,
      batch.map(({ row }) => row),
      oldest,
    );
  }
  await db.syncState.update("state", { lastSyncAt: Date.now() });
  return ok(usage);
};

/**
 * Receives every chunk after the cursor, then sends what waits, one chunk at a time. Receiving
 * comes first: a note re-asserted by a merge goes out in the same run.
 */
export const syncNow = (db: Database, accountId: string): Promise<Result<SyncUsage, SyncFailure>> =>
  exclusive(async () => {
    try {
      return await run(db, accountId);
    } catch (error) {
      return err(storage(String(error)));
    }
  }, false);

/** Turns sync on: everything waits, so the first upload holds the whole device. */
export const turnOn = (
  db: Database,
  accountId: string,
  now: number,
): Promise<Result<null, SyncFailure>> =>
  exclusive(async () => {
    try {
      await db.transaction("rw", ["syncState", "syncEntities", ...SYNCED_TABLES], async () => {
        await db.syncState.put({
          id: "state",
          accountId,
          cursor: 0,
          oldest: null,
          lastSyncAt: null,
        } satisfies SyncState);
        await markAllWaiting(db, now);
      });
      return ok(null);
    } catch (error) {
      return err(storage(String(error)));
    }
  }, true);

/** Deletes the server's copy for every device, then forgets sync here: the device's data stays. */
export const turnOff = (db: Database): Promise<Result<null, SyncFailure>> =>
  exclusive(async () => {
    const deleted = await deleteStore();
    if (!deleted.ok) return err(apiFailure(deleted.error));
    try {
      await db.transaction("rw", [db.syncState, db.syncEntities], async () => {
        await db.syncState.delete("state");
        await clearEntities(db);
      });
      return ok(null);
    } catch (error) {
      return err(storage(String(error)));
    }
  }, true);

/** At app start: with sync off, what was recorded while a tab was activating is not needed. */
export const clearWhenOff = async (db: Database): Promise<Result<null, SyncFailure>> => {
  try {
    await db.transaction("rw", [db.syncState, db.syncEntities], async () => {
      if ((await db.syncState.get("state")) == null) await clearEntities(db);
    });
    return ok(null);
  } catch (error) {
    return err(storage(String(error)));
  }
};
