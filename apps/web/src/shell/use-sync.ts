import type { SyncUsage } from "@openlinguo/core/sync";
import { useEffect, useSyncExternalStore } from "react";
import { loadSession, stepOf } from "@/data/account";
import { database } from "@/data/database";
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
let lastAttemptAt = Number.NEGATIVE_INFINITY;

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

/** Offline does not count as an attempt: coming back online syncs at once. */
const attempted = (failure: SyncFailure): void => {
  if (!(failure.kind === "api" && failure.failure.kind === "offline")) lastAttemptAt = Date.now();
};

const once = async (): Promise<void> => {
  let on: boolean;
  try {
    on = (await database.syncState.get("state")) != null;
  } catch (error) {
    fail({ kind: "storage", message: String(error) });
    return;
  }
  if (!on) return;
  const session = await loadSession();
  if (!session.ok) {
    const failure: SyncFailure = { kind: "api", failure: session.error };
    fail(failure);
    attempted(failure);
    return;
  }
  if (session.value === null || stepOf(session.value) !== "ready") return;
  publish({ ...view, running: true });
  const result = await syncNow(database, session.value.user.id);
  if (result.ok) {
    lastAttemptAt = Date.now();
    publish({ running: false, usage: result.value, failure: null });
    return;
  }
  const { error } = result;
  if (error.kind === "busy") {
    publish({ ...view, running: false });
    return;
  }
  fail(error);
  attempted(error);
};

const attempt = async (): Promise<void> => {
  if (inFlight || Date.now() - lastAttemptAt < SYNC_MIN_INTERVAL_MS) return;
  inFlight = true;
  try {
    await once();
  } finally {
    inFlight = false;
  }
};

/** Syncs unless it ran within `SYNC_MIN_INTERVAL_MS`, sync is off or nobody is signed in. */
export const requestSync = (): Promise<void> => attempt();

const start = async (): Promise<void> => {
  const cleared = await clearWhenOff(database);
  if (cleared.ok) await attempt();
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
