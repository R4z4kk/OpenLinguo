import { SYNC_HEADERS } from "@openlinguo/core/sync";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportAccountFile, exportSyncedData } from "./account-export.ts";
import { encodeChunk, SYNC_FORMAT, SYNC_VERSION, type SyncChunk } from "./sync-chunk.ts";

const ACCOUNT_EXPORT = {
  exportedAt: "2026-11-03T10:00:00.000Z",
  account: {
    id: "user-1",
    email: "lin@example.test",
    pseudonym: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    ageDeclaredAt: "2026-10-01T10:00:00.000Z",
    role: null,
    twoFactorEnabled: false,
    activeAt: null,
    inactivityNoticeAt: null,
  },
  signInMethods: [],
  sessions: [],
  submissions: [],
  decisions: [],
  securityEvents: [],
};

const chunkOf = (headword: string): SyncChunk => ({
  format: SYNC_FORMAT,
  version: SYNC_VERSION,
  reviews: [],
  entities: [
    {
      table: "knownMarks",
      key: JSON.stringify([headword, "x"]),
      changedAt: 1,
      deleted: false,
      value: { headword, readingKey: "x", markedAt: 1 },
    },
  ],
});

type Server = {
  chunks: Uint8Array[];
  account: Response | null;
  offline: boolean;
};

let server: Server;

const serve = (input: string): Promise<Response> => {
  const url = new URL(input, "http://localhost");
  if (server.offline) return Promise.reject(new TypeError("offline"));
  if (url.pathname === "/api/account/export")
    return Promise.resolve(server.account ?? Response.json(ACCOUNT_EXPORT));
  const after = Number(url.searchParams.get("after"));
  const headers = new Headers({ [SYNC_HEADERS.used]: "0" });
  const bytes = server.chunks[after];
  if (server.chunks.length > 0) headers.set(SYNC_HEADERS.oldest, "1");
  if (bytes == null) return Promise.resolve(new Response(null, { status: 204, headers }));
  headers.set(SYNC_HEADERS.id, String(after + 1));
  return Promise.resolve(new Response(new Uint8Array(bytes), { status: 200, headers }));
};

beforeEach(() => {
  server = { chunks: [], account: null, offline: false };
  vi.stubGlobal("fetch", serve);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const gzipped = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );

describe("exportSyncedData", () => {
  it("the export includes synced chunks, decoded and in order", async () => {
    server.chunks = [await encodeChunk(chunkOf("猫")), await encodeChunk(chunkOf("好"))];

    expect(await exportSyncedData()).toEqual({ ok: true, value: [chunkOf("猫"), chunkOf("好")] });
  });

  it("an account with no chunk exports an empty list", async () => {
    expect(await exportSyncedData()).toEqual({ ok: true, value: [] });
  });

  it("a chunk failing to decode fails with its id, and no later chunk is read", async () => {
    server.chunks = [
      await encodeChunk(chunkOf("猫")),
      new Uint8Array([0x1f, 0x8b, 1, 2, 3]),
      await encodeChunk(chunkOf("好")),
    ];

    expect(await exportSyncedData()).toEqual({
      ok: false,
      error: { kind: "unreadable-chunk", chunkId: 2 },
    });
  });

  it("a chunk of a newer format fails with its version", async () => {
    server.chunks = [
      await gzipped(JSON.stringify({ format: SYNC_FORMAT, version: SYNC_VERSION + 1 })),
    ];

    expect(await exportSyncedData()).toEqual({
      ok: false,
      error: { kind: "newer-format", version: SYNC_VERSION + 1 },
    });
  });

  it("an offline server fails with the API failure", async () => {
    server.offline = true;

    expect(await exportSyncedData()).toEqual({
      ok: false,
      error: { kind: "api", failure: { kind: "offline" } },
    });
  });

  it("a browser without DecompressionStream gets unavailable, and asks the server nothing", async () => {
    server.chunks = [await encodeChunk(chunkOf("猫"))];
    const calls = vi.fn(serve);
    vi.stubGlobal("fetch", calls);
    const saved = Object.getOwnPropertyDescriptor(globalThis, "DecompressionStream");
    Reflect.deleteProperty(globalThis, "DecompressionStream");
    try {
      expect(await exportSyncedData()).toEqual({ ok: false, error: { kind: "unavailable" } });
    } finally {
      if (saved) Object.defineProperty(globalThis, "DecompressionStream", saved);
    }
    expect(calls).not.toHaveBeenCalled();
  });
});

describe("exportAccountFile", () => {
  it("adds the synced chunks to the account export as `synced`", async () => {
    server.chunks = [await encodeChunk(chunkOf("猫"))];

    expect(await exportAccountFile()).toEqual({
      ok: true,
      value: { ...ACCOUNT_EXPORT, synced: [chunkOf("猫")] },
    });
  });

  it("a chunk failing to decode fails the export, and no file is produced", async () => {
    server.chunks = [new Uint8Array([0x1f, 0x8b, 1, 2, 3])];

    expect(await exportAccountFile()).toEqual({
      ok: false,
      error: { kind: "unreadable-chunk", chunkId: 1 },
    });
  });

  it("a failing account export is reported and the chunks are not read", async () => {
    server.account = Response.json({ code: "UNAUTHORIZED", message: "no" }, { status: 401 });
    const calls = vi.fn(serve);
    vi.stubGlobal("fetch", calls);

    expect(await exportAccountFile()).toEqual({
      ok: false,
      error: { kind: "api", failure: { kind: "refused", code: "UNAUTHORIZED" } },
    });
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
