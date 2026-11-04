import { gzipSync } from "node:zlib";
import { StoredChunk, SYNC_HEADERS, SYNC_LIMITS, SyncUsage } from "@openlinguo/core/sync";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import {
  account,
  codeRequest,
  database,
  erasure,
  hostingRecord,
  rateLimit,
  sealedIdentity,
  securityEvent,
  session,
  syncChunk,
  twoFactor,
  user,
} from "./schema.ts";
import { memoryMailer } from "./testing/memory-mailer.ts";
import { migratedPlatform } from "./testing/platform.ts";

const ORIGIN = "https://openlinguo.example.test";
const platform = await migratedPlatform();
const db = database(platform.env.DB);
const env = {
  ...platform.env,
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
  BETTER_AUTH_URL: ORIGIN,
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  GITHUB_CLIENT_ID: "github-id",
  GITHUB_CLIENT_SECRET: "github-secret",
  LETTERMINT_API_TOKEN: "lm_test_token",
  MAIL_FROM: "no-reply@example.test",
  CONTACT_EMAIL: "contact@example.test",
  SIGNUPS_OPEN: "true",
};
afterAll(() => platform.dispose());

let mailer = memoryMailer();
const mail = () => (message: Parameters<typeof mailer.sendMail>[0]) => mailer.sendMail(message);
const app = createApp([], mail);
const fullStoreApp = createApp([], mail, { ...SYNC_LIMITS, databaseBytes: 1 });
let ip = 0;
beforeEach(async () => {
  for (const table of [
    codeRequest,
    securityEvent,
    rateLimit,
    hostingRecord,
    sealedIdentity,
    erasure,
    syncChunk,
    twoFactor,
    session,
    account,
    user,
  ]) {
    await db.delete(table);
  }
  mailer = memoryMailer();
  ip += 1;
});

const headersOf = (cookie: string | null) => ({
  origin: ORIGIN,
  "cf-connecting-ip": `198.51.100.${String(ip)}`,
  ...(cookie ? { cookie } : {}),
});

const call = (path: string, init: RequestInit = {}, target: typeof app = app) =>
  target.fetch(new Request(`${ORIGIN}${path}`, init), env);

const signedIn = async (email: string) => {
  const send = (path: string, body: object) =>
    call(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headersOf(null) },
      body: JSON.stringify(body),
    });
  await send("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
  const otp = /\b(\d{6})\b/.exec(mailer.sent.at(-1)?.text ?? "")?.[1];
  if (!otp) throw new Error("no code mailed");
  const cookie = (await send("/api/auth/sign-in/email-otp", { email, otp })).headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  const age = await call("/api/account/age", {
    method: "POST",
    headers: { "content-type": "application/json", ...headersOf(cookie) },
    body: JSON.stringify({ answer: "15-or-over" }),
  });
  expect(age.status).toBe(204);
  return cookie;
};

const post = (
  cookie: string | null,
  body: Uint8Array,
  target: typeof app = app,
  expectedOldest: string | null = null,
) =>
  call(
    "/api/sync/chunks",
    {
      method: "POST",
      headers: {
        "content-type": "application/gzip",
        ...headersOf(cookie),
        ...(expectedOldest === null ? {} : { [SYNC_HEADERS.expectedOldest]: expectedOldest }),
      },
      body,
    },
    target,
  );
const next = (cookie: string | null, after: number) =>
  call(`/api/sync/chunks/next?after=${String(after)}`, { headers: headersOf(cookie) });
const clear = (cookie: string | null) =>
  call("/api/sync/chunks", { method: "DELETE", headers: headersOf(cookie) });

const gzipped = (text = "reviews") => new Uint8Array(gzipSync(text));
const gzipHeaded = (length: number) => {
  const body = new Uint8Array(length);
  body.set([0x1f, 0x8b]);
  return body;
};
const stored = async (response: Response) => StoredChunk.parse(await response.json());

const userIdOf = async (email: string) =>
  (await db.select({ id: user.id }).from(user).where(eq(user.email, email)))[0]?.id ?? "";

const records = async () =>
  (await db.select().from(hostingRecord).orderBy(hostingRecord.id)).map(
    ({ submissionId, operation, ipAddress, protocol }) => ({
      submissionId,
      operation,
      ipAddress,
      protocol,
    }),
  );

describe("POST /api/sync/chunks", () => {
  it("stores a chunk and reads back the same bytes", async () => {
    const cookie = await signedIn("lin@example.test");
    const bytes = gzipped("a chunk of reviews");
    const created = await post(cookie, bytes);
    expect(created.status).toBe(201);
    const chunk = await stored(created);
    expect(chunk).toMatchObject({ used: bytes.length, limit: SYNC_LIMITS.accountBytes });
    expect(chunk.oldest).toBe(chunk.id);

    const read = await next(cookie, 0);
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toBe("application/gzip");
    expect(read.headers.get("cache-control")).toBe("no-store");
    expect(read.headers.get(SYNC_HEADERS.id)).toBe(String(chunk.id));
    expect(read.headers.get(SYNC_HEADERS.oldest)).toBe(String(chunk.id));
    expect(read.headers.get(SYNC_HEADERS.used)).toBeNull();
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);
  });

  it("refuses without a session", async () => {
    const response = await post(null, gzipped());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("refuses a body not starting with 0x1f 0x8b", async () => {
    const cookie = await signedIn("lin@example.test");
    for (const body of [new TextEncoder().encode("{}"), new Uint8Array([0x1f]), new Uint8Array()]) {
      const response = await post(cookie, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
    }
    expect(await db.select().from(syncChunk)).toEqual([]);
  });

  it("refuses a body not sent as application/gzip, which a form could send without a preflight", async () => {
    const cookie = await signedIn("lin@example.test");
    for (const type of ["text/plain", "application/octet-stream", null]) {
      const response = await call("/api/sync/chunks", {
        method: "POST",
        headers: { ...headersOf(cookie), ...(type === null ? {} : { "content-type": type }) },
        body: gzipped(),
      });
      expect(response.status).toBe(415);
      expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
    }
    expect(await db.select().from(syncChunk)).toEqual([]);
    expect(await records()).toEqual([]);
  });

  it("refuses a chunk over 262144 bytes", async () => {
    const cookie = await signedIn("lin@example.test");
    const response = await post(cookie, gzipHeaded(SYNC_LIMITS.chunkBytes + 1));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "SYNC_CHUNK_TOO_LARGE" });
    expect((await post(cookie, gzipHeaded(SYNC_LIMITS.chunkBytes))).status).toBe(201);
  });

  it("refuses past 10485760 bytes for the account", async () => {
    const cookie = await signedIn("lin@example.test");
    const userId = await userIdOf("lin@example.test");
    await db.insert(syncChunk).values({
      userId,
      bytes: gzipped(),
      size: SYNC_LIMITS.accountBytes - 10,
    });
    const response = await post(cookie, gzipHeaded(11));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "SYNC_QUOTA" });
    expect((await post(cookie, gzipHeaded(10))).status).toBe(201);
  });

  it("refuses the 121st chunk of the hour", async () => {
    const cookie = await signedIn("lin@example.test");
    for (let sent = 0; sent < SYNC_LIMITS.chunksPerHour; sent += 1) {
      expect((await post(cookie, gzipped())).status).toBe(201);
    }
    const response = await post(cookie, gzipped());
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
    expect(await db.select().from(syncChunk)).toHaveLength(SYNC_LIMITS.chunksPerHour);
  }, 30_000);

  it("refuses once the database is over the limit", async () => {
    const cookie = await signedIn("lin@example.test");
    const response = await post(cookie, gzipped(), fullStoreApp);
    expect(response.status).toBe(507);
    expect(await response.json()).toMatchObject({ code: "SYNC_STORE_FULL" });
    expect(await db.select().from(syncChunk)).toEqual([]);
    expect(await records()).toEqual([]);
  });
});

describe("POST /api/sync/chunks with the oldest chunk the device remembers", () => {
  it("accepts a match and no header", async () => {
    const cookie = await signedIn("lin@example.test");
    const first = await stored(await post(cookie, gzipped("one")));
    const matched = await post(cookie, gzipped("two"), app, String(first.id));
    expect(matched.status).toBe(201);
    expect((await stored(matched)).oldest).toBe(first.id);
    expect((await post(cookie, gzipped("three"))).status).toBe(201);
    expect(await db.select().from(syncChunk)).toHaveLength(3);
  });

  it("refuses a differing oldest and writes nothing", async () => {
    const cookie = await signedIn("lin@example.test");
    const first = await stored(await post(cookie, gzipped("one")));
    const chunks = await db.select().from(syncChunk);
    const written = await records();

    const response = await post(cookie, gzipped("two"), app, String(first.id + 1));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "SYNC_STORE_CHANGED" });
    expect(await db.select().from(syncChunk)).toEqual(chunks);
    expect(await records()).toEqual(written);
  });

  it("refuses an empty store and writes nothing", async () => {
    const cookie = await signedIn("lin@example.test");
    const first = await stored(await post(cookie, gzipped("one")));
    expect((await clear(cookie)).status).toBe(204);
    const written = await records();

    const response = await post(cookie, gzipped("two"), app, String(first.id));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "SYNC_STORE_CHANGED" });
    expect(await db.select().from(syncChunk)).toEqual([]);
    expect(await records()).toEqual(written);
  });

  it("refuses a header that is not a chunk id", async () => {
    const cookie = await signedIn("lin@example.test");
    for (const header of ["abc", "0", "-1", "1.5"]) {
      const response = await post(cookie, gzipped(), app, header);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
    }
    expect(await db.select().from(syncChunk)).toEqual([]);
  });

  it("compares with the caller's own store", async () => {
    const lin = await signedIn("lin@example.test");
    const first = await stored(await post(lin, gzipped("one")));
    const ming = await signedIn("ming@example.test");
    const response = await post(ming, gzipped("two"), app, String(first.id));
    expect(response.status).toBe(409);
  });
});

describe("GET /api/sync/chunks/next", () => {
  it("walks the chunks in order and answers 204 with the usage after the last", async () => {
    const cookie = await signedIn("lin@example.test");
    const first = await stored(await post(cookie, gzipped("one")));
    const second = await stored(await post(cookie, gzipped("two")));
    expect((await next(cookie, 0)).headers.get(SYNC_HEADERS.id)).toBe(String(first.id));
    expect((await next(cookie, first.id)).headers.get(SYNC_HEADERS.id)).toBe(String(second.id));
    const end = await next(cookie, second.id);
    expect(end.status).toBe(204);
    expect(end.headers.get(SYNC_HEADERS.oldest)).toBe(String(first.id));
    expect(end.headers.get(SYNC_HEADERS.used)).toBe(String(second.used));
    expect(end.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 204 with no oldest chunk for an empty store", async () => {
    const cookie = await signedIn("lin@example.test");
    const end = await next(cookie, 0);
    expect(end.status).toBe(204);
    expect(end.headers.get(SYNC_HEADERS.oldest)).toBeNull();
    expect(end.headers.get(SYNC_HEADERS.used)).toBe("0");
  });

  it("refuses without a session and a cursor that is not a number", async () => {
    expect((await next(null, 0)).status).toBe(401);
    const cookie = await signedIn("lin@example.test");
    for (const after of ["x", "-1", "1.5", ""]) {
      const response = await call(`/api/sync/chunks/next?after=${after}`, {
        headers: headersOf(cookie),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
    }
    expect((await call("/api/sync/chunks/next", { headers: headersOf(cookie) })).status).toBe(400);
  });

  it("never returns another account's chunk", async () => {
    const lin = await signedIn("lin@example.test");
    const wei = await signedIn("wei@example.test");
    const chunk = await stored(await post(lin, gzipped("private")));
    const other = await next(wei, 0);
    expect(other.status).toBe(204);
    expect(other.headers.get(SYNC_HEADERS.oldest)).toBeNull();
    expect(other.headers.get(SYNC_HEADERS.used)).toBe("0");
    expect((await next(lin, 0)).headers.get(SYNC_HEADERS.id)).toBe(String(chunk.id));
  });
});

describe("what reading costs D1", () => {
  const CHUNKS = 20;

  /** Reads to the end, keeping the statements of the answers with a chunk and of the last one. */
  const readAll = async (cookie: string) => {
    let statements: string[] = [];
    const DB = new Proxy(env.DB, {
      get: (target, name): unknown => {
        if (name === "prepare")
          return (statement: string) => {
            statements.push(statement);
            return target.prepare(statement);
          };
        const value: unknown = Reflect.get(target, name);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const read = (after: number) =>
      app.fetch(
        new Request(`${ORIGIN}/api/sync/chunks/next?after=${String(after)}`, {
          headers: headersOf(cookie),
        }),
        { ...env, DB },
      );
    let after = 0;
    for (let count = 0; count < CHUNKS; count += 1) {
      const answer = await read(after);
      expect(answer.status).toBe(200);
      expect(answer.headers.get(SYNC_HEADERS.oldest)).not.toBeNull();
      after = Number(answer.headers.get(SYNC_HEADERS.id));
    }
    const chunks = statements;
    statements = [];
    const end = await read(after);
    expect(end.status).toBe(204);
    expect(end.headers.get(SYNC_HEADERS.used)).toBe(String(CHUNKS * 10));
    return { chunks, end: statements };
  };

  it("reading through the chunks runs the sum only on the last answer", async () => {
    const cookie = await signedIn("lin@example.test");
    const userId = await userIdOf("lin@example.test");
    await db
      .insert(syncChunk)
      .values(Array.from({ length: CHUNKS }, () => ({ userId, bytes: gzipped(), size: 10 })));

    const { chunks, end } = await readAll(cookie);

    expect(chunks.filter((statement) => statement.includes("sum("))).toEqual([]);
    expect(end.filter((statement) => statement.includes("sum("))).toHaveLength(1);

    const oldest = chunks.find((statement) => statement.includes("min(id)")) ?? null;
    if (oldest === null) throw new Error("no read of the oldest chunk");
    const { meta } = await env.DB.prepare(oldest).bind(userId).all();
    expect(meta.rows_read).toBe(1);
  });
});

describe("DELETE /api/sync/chunks", () => {
  it("removes only the caller's chunks", async () => {
    const lin = await signedIn("lin@example.test");
    const wei = await signedIn("wei@example.test");
    await post(lin, gzipped("one"));
    const kept = await stored(await post(wei, gzipped("two")));
    expect((await clear(lin)).status).toBe(204);
    expect((await next(lin, 0)).status).toBe(204);
    expect((await next(wei, 0)).headers.get(SYNC_HEADERS.id)).toBe(String(kept.id));
    expect((await clear(null)).status).toBe(401);
  });

  it("answers the usage a device reads with the usage schema", async () => {
    const cookie = await signedIn("lin@example.test");
    const chunk = await stored(await post(cookie, gzipped()));
    expect(SyncUsage.parse(chunk)).toEqual({
      used: chunk.used,
      limit: chunk.limit,
      oldest: chunk.id,
    });
  });
});

describe("hosting records", () => {
  it("writes one per chunk, one for the deletion, and none for a read", async () => {
    const cookie = await signedIn("lin@example.test");
    const request = new Request(`${ORIGIN}/api/sync/chunks`, {
      method: "POST",
      headers: { "content-type": "application/gzip", ...headersOf(cookie) },
      body: gzipped(),
    });
    Object.defineProperty(request, "cf", {
      value: { httpProtocol: "HTTP/3", tlsVersion: "TLSv1.3" },
    });
    const first = await stored(await app.fetch(request, env));
    const second = await stored(await post(cookie, gzipped("two")));
    await next(cookie, 0);
    await next(cookie, second.id);
    const connection = `198.51.100.${String(ip)}`;
    expect(await records()).toEqual([
      {
        submissionId: `sync:${String(first.id)}`,
        operation: "create",
        ipAddress: connection,
        protocol: "HTTP/3 TLSv1.3",
      },
      {
        submissionId: `sync:${String(second.id)}`,
        operation: "create",
        ipAddress: connection,
        protocol: null,
      },
    ]);
    await clear(cookie);
    expect((await records()).at(-1)).toEqual({
      submissionId: "sync:all",
      operation: "delete",
      ipAddress: connection,
      protocol: null,
    });
    expect(await records()).toHaveLength(3);
  });

  it("writes none for a refused chunk, and none to clear an empty store", async () => {
    const cookie = await signedIn("lin@example.test");
    await post(cookie, new TextEncoder().encode("{}"));
    await clear(cookie);
    expect(await records()).toEqual([]);
  });
});

describe("account deletion", () => {
  it("removes the chunks, writes sync:all and seals the identity", async () => {
    const cookie = await signedIn("lin@example.test");
    const chunk = await stored(await post(cookie, gzipped()));
    const response = await call("/api/account/delete", {
      method: "POST",
      headers: { "content-type": "application/json", ...headersOf(cookie) },
      body: JSON.stringify({ published: "remove" }),
    });
    expect(response.status).toBe(204);
    expect(await db.select().from(syncChunk)).toEqual([]);
    expect(
      (await records()).map(({ submissionId, operation }) => [submissionId, operation]),
    ).toEqual([
      [`sync:${String(chunk.id)}`, "create"],
      ["sync:all", "delete"],
    ]);
    expect(await db.select({ email: sealedIdentity.email }).from(sealedIdentity)).toEqual([
      { email: "lin@example.test" },
    ]);
  });

  it("seals the identity of an account whose records were purged but whose chunks remain", async () => {
    const cookie = await signedIn("lin@example.test");
    await post(cookie, gzipped());
    await db.delete(hostingRecord);
    await call("/api/account/delete", {
      method: "POST",
      headers: { "content-type": "application/json", ...headersOf(cookie) },
      body: JSON.stringify({ published: "remove" }),
    });
    expect(await db.select().from(sealedIdentity)).toHaveLength(1);
    expect((await records()).map(({ submissionId }) => submissionId)).toEqual(["sync:all"]);
  });

  it("writes no sync record for an account without chunks", async () => {
    const cookie = await signedIn("lin@example.test");
    await call("/api/account/delete", {
      method: "POST",
      headers: { "content-type": "application/json", ...headersOf(cookie) },
      body: JSON.stringify({ published: "remove" }),
    });
    expect(await records()).toEqual([]);
  });
});
