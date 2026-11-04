import "fake-indexeddb/auto";
import { SYNC_HEADERS, SYNC_LIMITS } from "@openlinguo/core/sync";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/data/database";
import { encodeChunk, SYNC_FORMAT, SYNC_VERSION } from "@/data/sync-chunk";

const SESSION = {
  session: { twoFactorVerifiedAt: null },
  user: {
    id: "user-1",
    email: "lin@example.test",
    name: "",
    ageDeclaredAt: "2026-10-31T10:00:00.000Z",
  },
};

type Network = {
  session: unknown;
  offline: boolean;
  calls: string[];
  chunks: readonly Uint8Array[];
};

let network: Network;
let now: number;
let db: Database;

const load = async () => {
  vi.resetModules();
  const [sync, database] = await Promise.all([import("./use-sync.ts"), import("@/data/database")]);
  db = database.database;
  return sync;
};

const turnedOn = (accountId = "user-1"): Promise<unknown> =>
  db.syncState.put({ id: "state", accountId, cursor: 0, oldest: null, lastSyncAt: null });

beforeEach(() => {
  network = { session: SESSION, offline: false, calls: [], chunks: [] };
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.stubGlobal("navigator", {
    userAgent: "node",
    locks: { request: (_n: string, _o: object, run: (lock: object) => unknown) => run({}) },
  });
  vi.stubGlobal("fetch", (input: string) => {
    network.calls.push(new URL(input, "http://localhost").pathname);
    if (network.offline) return Promise.reject(new TypeError("offline"));
    if (input.startsWith("/api/auth/get-session"))
      return Promise.resolve(new Response(JSON.stringify(network.session)));
    const after = Number(new URL(input, "http://localhost").searchParams.get("after"));
    const bytes = network.chunks[after] ?? null;
    if (bytes === null) {
      const oldest = network.chunks.length > 0 ? { [SYNC_HEADERS.oldest]: "1" } : {};
      return Promise.resolve(
        new Response(null, { status: 204, headers: { [SYNC_HEADERS.used]: "0", ...oldest } }),
      );
    }
    return Promise.resolve(
      new Response(new Uint8Array(bytes), {
        headers: { [SYNC_HEADERS.id]: String(after + 1), [SYNC_HEADERS.oldest]: "1" },
      }),
    );
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  db.close();
  await Dexie.delete("openlinguo");
});

describe("requestSync", () => {
  it("does nothing while sync is off", async () => {
    const { requestSync, currentSyncView } = await load();
    await requestSync();
    expect(network.calls).toEqual([]);
    expect(currentSyncView().failure).toBeNull();
  });

  it("syncs the signed-in account and shows its usage", async () => {
    const { requestSync, currentSyncView } = await load();
    await turnedOn();
    await requestSync();
    expect(network.calls).toEqual(["/api/auth/get-session", "/api/sync/chunks/next"]);
    expect(currentSyncView()).toEqual({
      running: false,
      usage: { used: 0, limit: SYNC_LIMITS.accountBytes, oldest: null },
      failure: null,
      revision: 0,
    });
  });

  it("does nothing when signed out or before the account is ready", async () => {
    const { requestSync } = await load();
    await turnedOn();
    network.session = null;
    await requestSync();
    network.session = { ...SESSION, user: { ...SESSION.user, ageDeclaredAt: null } };
    await requestSync();
    expect(network.calls).toEqual(["/api/auth/get-session", "/api/auth/get-session"]);
  });

  it("runs at most every five minutes", async () => {
    const { requestSync } = await load();
    await turnedOn();
    await requestSync();
    now += 299_999;
    await requestSync();
    expect(network.calls).toHaveLength(2);
    now += 1;
    await requestSync();
    expect(network.calls).toHaveLength(4);
  });

  it("holds across a reload: a fresh hook reads the last success from the device", async () => {
    const first = await load();
    await turnedOn();
    await first.requestSync();
    expect(network.calls).toHaveLength(2);

    const reloaded = await load();
    now += 1_000;
    await reloaded.requestSync();
    expect(network.calls).toHaveLength(2);
    now += 299_000;
    await reloaded.requestSync();
    expect(network.calls).toHaveLength(4);
  });

  it("a state synced a second ago waits, and force ignores the limit", async () => {
    const { requestSync } = await load();
    await db.syncState.put({
      id: "state",
      accountId: "user-1",
      cursor: 0,
      oldest: null,
      lastSyncAt: now - 1_000,
    });
    await requestSync();
    expect(network.calls).toEqual([]);
    await requestSync(true);
    expect(network.calls).toHaveLength(2);
  });

  it("offline shows the failure, does not count, and the next success clears it", async () => {
    const { requestSync, currentSyncView } = await load();
    await turnedOn();
    network.offline = true;
    await requestSync();
    expect(currentSyncView().failure).toEqual({ kind: "api", failure: { kind: "offline" } });

    network.offline = false;
    await requestSync();
    expect(currentSyncView().failure).toBeNull();
    expect(currentSyncView().usage).not.toBeNull();
  });

  it("another account's state stays visible as a failure and is retried at the next trigger", async () => {
    const { requestSync, currentSyncView } = await load();
    await turnedOn("someone-else");
    await requestSync();
    expect(currentSyncView().failure).toEqual({ kind: "other-account" });
    await requestSync();
    expect(network.calls).toHaveLength(2);
  });
});

describe("the revision", () => {
  const empty = () =>
    encodeChunk({ format: SYNC_FORMAT, version: SYNC_VERSION, reviews: [], entities: [] });
  const CORRUPT = new Uint8Array([0x1f, 0x8b, 1, 2, 3]);

  it("moves when a run moved the cursor", async () => {
    const { requestSync, currentSyncView } = await load();
    await turnedOn();
    network.chunks = [await empty(), await empty()];
    await requestSync();
    expect((await db.syncState.get("state"))?.cursor).toBe(2);
    expect(currentSyncView().revision).toBe(1);
  });

  it("moves when a run moved the cursor and then failed", async () => {
    const { requestSync, currentSyncView } = await load();
    await turnedOn();
    network.chunks = [await empty(), CORRUPT];
    await requestSync();
    expect((await db.syncState.get("state"))?.cursor).toBe(1);
    expect(currentSyncView().failure).toEqual({ kind: "unreadable-chunk", chunkId: 2 });
    expect(currentSyncView().revision).toBe(1);
  });

  it("stays when the cursor stayed: nothing new, a failure, or a run the limit stopped", async () => {
    const { requestSync, currentSyncView } = await load();
    await turnedOn();
    await requestSync();
    expect(currentSyncView().revision).toBe(0);

    await requestSync(true);
    expect(currentSyncView().revision).toBe(0);

    network.offline = true;
    await requestSync(true);
    expect(currentSyncView().failure).not.toBeNull();
    expect(currentSyncView().revision).toBe(0);

    network.offline = false;
    network.chunks = [CORRUPT];
    await requestSync(true);
    expect(currentSyncView().failure).toEqual({ kind: "unreadable-chunk", chunkId: 1 });
    expect(currentSyncView().revision).toBe(0);
  });

  it("stays when the limit stops the run, with a chunk waiting on the server", async () => {
    const { requestSync, currentSyncView } = await load();
    await db.syncState.put({
      id: "state",
      accountId: "user-1",
      cursor: 0,
      oldest: null,
      lastSyncAt: now - 1_000,
    });
    network.chunks = [await empty()];
    await requestSync();
    expect((await db.syncState.get("state"))?.cursor).toBe(0);
    expect(currentSyncView().revision).toBe(0);
  });

  it("is kept by a reset, so a screen does not read that as a merge", async () => {
    const { requestSync, resetSyncView, currentSyncView } = await load();
    await turnedOn();
    network.chunks = [await empty()];
    await requestSync();
    resetSyncView();
    expect(currentSyncView().revision).toBe(1);
  });
});

describe("listenForSync", () => {
  type Page = EventTarget & { visibilityState: string };

  const settle = (): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

  const pageGlobals = (): { readonly page: Page; readonly online: EventTarget } => {
    const page: Page = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const online = new EventTarget();
    vi.stubGlobal("document", page);
    vi.stubGlobal("window", online);
    return { page, online };
  };

  it("coming back to the app syncs, within the limit, and hiding it does not", async () => {
    const { listenForSync } = await load();
    await turnedOn();
    const { page } = pageGlobals();
    const stop = listenForSync();

    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(network.calls).toEqual([]);

    page.visibilityState = "visible";
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => {
      expect(network.calls).toHaveLength(2);
    });
    await settle();

    now += 299_999;
    page.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(network.calls).toHaveLength(2);

    now += 1;
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => {
      expect(network.calls).toHaveLength(4);
    });
    await settle();
    stop();
  });

  it("the network coming back syncs, within the limit", async () => {
    const { listenForSync } = await load();
    await turnedOn();
    const { online } = pageGlobals();
    const stop = listenForSync();
    online.dispatchEvent(new Event("online"));
    await vi.waitFor(() => {
      expect(network.calls).toHaveLength(2);
    });
    await settle();
    online.dispatchEvent(new Event("online"));
    await settle();
    expect(network.calls).toHaveLength(2);
    stop();
  });

  it("stops listening when asked", async () => {
    const { listenForSync } = await load();
    await turnedOn();
    const { page, online } = pageGlobals();
    listenForSync()();
    page.dispatchEvent(new Event("visibilitychange"));
    online.dispatchEvent(new Event("online"));
    await settle();
    expect(network.calls).toEqual([]);
  });
});

describe("resetSyncView", () => {
  it("forgets the failure and the usage, as after turning sync off", async () => {
    const { requestSync, resetSyncView, currentSyncView } = await load();
    await turnedOn();
    network.offline = true;
    await requestSync();
    expect(currentSyncView().failure).not.toBeNull();

    resetSyncView();

    expect(currentSyncView()).toEqual({
      running: false,
      usage: null,
      failure: null,
      revision: 0,
    });
  });

  it("forgets the usage of the last success", async () => {
    const { requestSync, resetSyncView, currentSyncView } = await load();
    await turnedOn();
    await requestSync();
    expect(currentSyncView().usage).not.toBeNull();

    resetSyncView();

    expect(currentSyncView().usage).toBeNull();
  });
});
