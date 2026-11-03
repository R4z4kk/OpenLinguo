import { Dexie, type Table, type Transaction } from "dexie";
import type { Database } from "./database.ts";

export const SYNCED_TABLES = [
  "reviews",
  "cards",
  "decks",
  "deckWords",
  "notes",
  "knownMarks",
] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];

/** An entity sync may have to send, with the time of its last change (ADR 0016). */
export type SyncEntity = {
  /** `<table>:<key>` */
  id: string;
  table: SyncedTable;
  /** The primary key, `JSON.stringify`-ed when it is an array. */
  key: string;
  changedAt: number;
  deleted: boolean;
  /** 1 while waiting to be sent: an index key, as booleans are not indexable. */
  pending: 0 | 1;
};

/** Transactions whose writes are applied from another device, so not recorded. */
const silenced = new WeakSet<Transaction>();

const record = (table: SyncedTable, key: string, deleted: boolean, tx: Transaction): void => {
  if (silenced.has(tx) || tx.idbtrans.mode === "versionchange") return;
  if (!tx.storeNames.includes("syncEntities"))
    throw new Error(`Write to ${table} outside a sync-aware transaction`);
  const entity: SyncEntity = {
    id: `${table}:${key}`,
    table,
    key,
    changedAt: Date.now(),
    deleted,
    pending: 1,
  };
  void tx.table<SyncEntity, string>("syncEntities").put(entity);
};

type Tracker = {
  readonly attach: () => void;
  readonly entities: (now: number) => Promise<SyncEntity[]>;
};

const tracker = <T, K, I>(
  table: SyncedTable,
  rows: Table<T, K, I>,
  key: (row: T) => string,
  hooked: { readonly updating: boolean; readonly deleting: boolean },
  changedAt: (row: T, now: number) => number = (_row, now) => now,
): Tracker => ({
  attach: () => {
    rows.hook("creating", (_key, row, tx) => {
      record(table, key(row), false, tx);
    });
    if (hooked.updating)
      rows.hook("updating", (_mods, _key, row, tx) => {
        record(table, key(row), false, tx);
      });
    if (hooked.deleting)
      // Dexie passes no row when the key is absent: nothing is deleted.
      rows.hook("deleting", (_key, row: T | null, tx) => {
        if (row != null) record(table, key(row), true, tx);
      });
  },
  entities: async (now) =>
    (await rows.toArray()).map((row) => ({
      id: `${table}:${key(row)}`,
      table,
      key: key(row),
      changedAt: changedAt(row, now),
      deleted: false,
      pending: 1,
    })),
});

const trackers = (db: Database): readonly Tracker[] => [
  tracker("reviews", db.reviews, (row) => row.id, {
    updating: false,
    deleting: false,
  }),
  tracker("cards", db.cards, (row) => row.id, {
    updating: false,
    deleting: true,
  }),
  tracker("decks", db.decks, (row) => row.id, {
    updating: true,
    deleting: true,
  }),
  tracker("deckWords", db.deckWords, (row) => row.id, {
    updating: true,
    deleting: true,
  }),
  tracker(
    "notes",
    db.notes,
    (row) => row.id,
    { updating: true, deleting: true },
    (row) => row.updatedAt,
  ),
  tracker("knownMarks", db.knownMarks, (row) => JSON.stringify([row.headword, row.readingKey]), {
    updating: true,
    deleting: true,
  }),
];

/**
 * Records every write to a synced table in the write's own transaction, which must include
 * `syncEntities`: a write that cannot record is refused rather than lost.
 */
export const recordChanges = (db: Database): void => {
  for (const { attach } of trackers(db)) attach();
};

/** Runs writes in the current transaction without recording them: changes received from sync. */
export const silently = async <T>(db: Database, run: () => Promise<T>): Promise<T> => {
  const tx = Dexie.currentTransaction as Transaction | null;
  if (tx === null || tx.db !== db) throw new Error("silently called outside a transaction");
  silenced.add(tx);
  try {
    return await run();
  } finally {
    silenced.delete(tx);
  }
};

/** Marks every entity, deletions included, as waiting to be sent: the first upload holds everything. */
export const markAllWaiting = (db: Database, now: number): Promise<void> =>
  db.transaction("rw", ["syncEntities", ...SYNCED_TABLES], async () => {
    await db.syncEntities.toCollection().modify({ pending: 1 });
    const live = await Promise.all(trackers(db).map(({ entities }) => entities(now)));
    await db.syncEntities.bulkPut(live.flat());
  });

export const clearEntities = (db: Database): Promise<void> => db.syncEntities.clear();
