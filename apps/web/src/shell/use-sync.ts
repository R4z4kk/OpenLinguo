import type { SyncUsage } from "@openlinguo/core/sync";
import { useEffect, useSyncExternalStore } from "react";
import { loadSession, stepOf } from "@/data/account";
import { database, type SyncState } from "@/data/database";
import { clearWhenOff, SYNC_MIN_INTERVAL_MS, syncNow, type SyncFailure } from "@/data/sync";

/** What the sync section reads: the last failure stays until a sync succeeds. */
export type SyncView = {
  readonly running: boolean;
  readonly usage: SyncUsage | null;
  readonly failure: SyncFailure | null;
};

let view: SyncView = { running: false, usage: null, failure: null };
const listeners = new Set<() => void>();
let inFlight = false;

const publish = (next: SyncView): void => {
  view = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const fail = (failure: SyncFailure): void => {
  publish({ ...view, running: false, failure });
};

/** The limit is the last success, kept on the device: a failure retries at the next trigger. */
const once = async (force: boolean): Promise<void> => {
  let state: SyncState | null;
  try {
    state = (await database.syncState.get("state")) ?? null;
  } catch (error) {
    fail({ kind: "storage", message: String(error) });
    return;
  }
  if (state === null) return;
  // A clock set back leaves `lastSyncAt` in the future: the limit then no longer holds.
  const age = state.lastSyncAt === null ? -1 : Date.now() - state.lastSyncAt;
  if (!force && age >= 0 && age < SYNC_MIN_INTERVAL_MS) return;
  const session = await loadSession();
  if (!session.ok) {
    fail({ kind: "api", failure: session.error });
    return;
  }
  if (session.value === null || stepOf(session.value) !== "ready") return;
  publish({ ...view, running: true });
  const result = await syncNow(database, session.value.user.id);
  if (result.ok) {
    publish({ running: false, usage: result.value, failure: null });
    return;
  }
  const { error } = result;
  if (error.kind === "busy") {
    publish({ ...view, running: false });
    return;
  }
  fail(error);
};

const attempt = async (force: boolean): Promise<void> => {
  if (inFlight) return;
  inFlight = true;
  try {
    await once(force);
  } finally {
    inFlight = false;
  }
};

/**
 * Syncs unless the last success is under `SYNC_MIN_INTERVAL_MS` old, sync is off or nobody is
 * signed in; `force` is for « Sync now ».
 */
export const requestSync = (force = false): Promise<void> => attempt(force);

const start = async (): Promise<void> => {
  const cleared = await clearWhenOff(database);
  if (cleared.ok) await attempt(false);
  else fail(cleared.error);
};

/** Syncs at app start and when the network comes back, and clears rows recorded while sync is off. */
export const useSync = (): void => {
  useEffect(() => {
    void start();
    const online = (): void => {
      void requestSync();
    };
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("online", online);
    };
  }, []);
};

export const currentSyncView = (): SyncView => view;

export const useSyncView = (): SyncView => useSyncExternalStore(subscribe, currentSyncView);
