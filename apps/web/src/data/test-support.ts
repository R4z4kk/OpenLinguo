import type { Database } from "./database.ts";
import { SYNCED_TABLES } from "./sync-entities.ts";

/** Runs seed writes to the synced tables in a transaction that records them, as the app's writers do. */
export const seedLearning = <T>(db: Database, run: () => Promise<T>): Promise<T> =>
  db.transaction("rw", ["syncEntities", ...SYNCED_TABLES], run);
