import "fake-indexeddb/auto";
import { SYNC_HEADERS, SYNC_LIMITS } from "@openlinguo/core/sync";
import { Dexie } from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/data/database";

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
  network = { session: SESSION, offline: false, calls: [] };
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
    return Promise.resolve(
      new Response(null, { status: 204, headers: { [SYNC_HEADERS.used]: "0" } }),
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
