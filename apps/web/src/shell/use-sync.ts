import type { SyncUsage } from "@openlinguo/core/sync";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { loadSession, stepOf } from "@/data/account";
import { database, type SyncState } from "@/data/database";
import { clearWhenOff, SYNC_MIN_INTERVAL_MS, syncNow, type SyncFailure } from "@/data/sync";

/** What the sync section reads: the last failure stays until a sync succeeds. */
export type SyncView = {
  readonly running: boolean;
  readonly usage: SyncUsage | null;
  readonly failure: SyncFailure | null;
  /** Moves when a run moved the cursor: what a screen read may have changed. */
  readonly revision: number;
};

let view: SyncView = { running: false, usage: null, failure: null, revision: 0 };
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

/** After turning sync off or on: nothing of the previous state may stay shown. */
export const resetSyncView = (): void => {
  publish({ ...view, usage: null, failure: null });
};

const fail = (failure: SyncFailure): void => {
  publish({ ...view, running: false, failure });
};

/** Whether a run moved the cursor, a failed one included. Not known counts as moved. */
const cursorMoved = async (before: number): Promise<boolean> => {
  try {
    const state = await database.syncState.get("state");
    return state != null && state.cursor !== before;
  } catch {
    return true;
  }
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
  const moved = await cursorMoved(state.cursor);
  const done = { ...view, running: false, revision: view.revision + (moved ? 1 : 0) };
  if (result.ok) publish({ ...done, usage: result.value, failure: null });
  else if (result.error.kind === "busy") publish(done);
  else publish({ ...done, failure: result.error });
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
 * signed in; `force` is for « Sync now » and the end of a session.
 */
export const requestSync = (force = false): Promise<void> => attempt(force);

const start = async (): Promise<void> => {
  const cleared = await clearWhenOff(database);
  if (cleared.ok) await attempt(false);
  else fail(cleared.error);
};

/** Leaving with changes: a session left midway does not wait for the next opening. */
const sendWaiting = async (): Promise<void> => {
  let waiting: number;
  try {
    waiting = await database.syncEntities.where("pending").equals(1).count();
  } catch (error) {
    fail({ kind: "storage", message: String(error) });
    return;
  }
  if (waiting > 0) await attempt(true);
};

/**
 * Syncs when the network or the learner comes back, and when the learner leaves with changes;
 * answers how to stop.
 */
export const listenForSync = (): (() => void) => {
  const online = (): void => {
    void requestSync();
  };
  const visibility = (): void => {
    void (document.visibilityState === "visible" ? requestSync() : sendWaiting());
  };
  window.addEventListener("online", online);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    window.removeEventListener("online", online);
    document.removeEventListener("visibilitychange", visibility);
  };
};

/** Syncs at app start and on the triggers above, and clears rows recorded while sync is off. */
export const useSync = (): void => {
  useEffect(() => {
    void start();
    return listenForSync();
  }, []);
};

export const currentSyncView = (): SyncView => view;

export const useSyncView = (): SyncView => useSyncExternalStore(subscribe, currentSyncView);

/** Calls `refresh` after a sync moved the revision, not when the screen opens. */
export const useAfterMerge = (refresh: () => void): void => {
  const { revision } = useSyncView();
  const seen = useRef(revision);
  useEffect(() => {
    if (seen.current === revision) return;
    seen.current = revision;
    refresh();
  }, [revision, refresh]);
};
