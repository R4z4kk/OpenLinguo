import type { ApiError } from "@openlinguo/core/api-error";
import { StoredChunk, SYNC_HEADERS, SYNC_LIMITS } from "@openlinguo/core/sync";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { Auth } from "./auth.ts";
import { withinLimit } from "./rate-limit.ts";
import { database, hostingRecord, syncChunk } from "./schema.ts";
import { type Connection, connectionOf, hostingRow } from "./submissions.ts";

export type SyncLimits = { readonly [Name in keyof typeof SYNC_LIMITS]: number };

const HOUR_MS = 60 * 60_000;

const refusal = (code: ApiError["code"], message: string): ApiError => ({ code, message });
const tooLarge = refusal("SYNC_CHUNK_TOO_LARGE", "A chunk is at most 256 KiB");

const UsageRow = z.object({
  used: z.number().int().nonnegative(),
  oldest: z.number().int().positive().nullable(),
});

/** The account's stored bytes and first chunk, and the database size D1 reports after the read. */
const usageOf = async (d1: D1Database, userId: string) => {
  const result = await d1
    .prepare(
      "SELECT coalesce(sum(size), 0) AS used, min(id) AS oldest FROM sync_chunk WHERE user_id = ?",
    )
    .bind(userId)
    .all();
  return { ...UsageRow.parse(result.results[0]), databaseBytes: result.meta.size_after };
};

const Expected = z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int().positive());

const After = z.string().regex(/^\d+$/u).transform(Number).pipe(z.number().int());

type Routes = {
  Bindings: Env;
  Variables: { readonly userId: string; readonly connection: Connection };
};

/** `/api/sync`: opaque gzip chunks of a learner's data, kept for their other devices (ADR 0016). */
export const syncRoutes = (authOf: (env: Env) => Auth, limits: SyncLimits = SYNC_LIMITS) =>
  new Hono<Routes>()
    .use(async (c, next) => {
      const current = await authOf(c.env).api.getSession({ headers: c.req.raw.headers });
      if (!current) return c.json(refusal("UNAUTHORIZED", "Sign in first"), 401);
      c.set("userId", current.user.id);
      // Read before bodyLimit, which may rebuild the request of a body sent without a length.
      c.set("connection", connectionOf(c.req.raw));
      return next();
    })
    .post(
      "/chunks",
      bodyLimit({ maxSize: limits.chunkBytes, onError: (c) => c.json(tooLarge, 413) }),
      async (c) => {
        const body = new Uint8Array(await c.req.arrayBuffer());
        if (body.length > limits.chunkBytes) return c.json(tooLarge, 413);
        if (body[0] !== 0x1f || body[1] !== 0x8b) {
          return c.json(refusal("INVALID_REQUEST", "Expected a gzip body"), 400);
        }
        const { userId } = c.var;
        const db = database(c.env.DB);
        const window = { max: limits.chunksPerHour, windowMs: HOUR_MS };
        if (!(await withinLimit(db, `sync:${userId}`, window, Date.now()))) {
          return c.json(refusal("TOO_MANY_ATTEMPTS", "Too many chunks, try again later"), 429);
        }
        const usage = await usageOf(c.env.DB, userId);
        const header = c.req.header(SYNC_HEADERS.expectedOldest) ?? null;
        if (header !== null) {
          const expected = Expected.safeParse(header);
          if (!expected.success) {
            return c.json(refusal("INVALID_REQUEST", "Expected the id of the oldest chunk"), 400);
          }
          if (usage.oldest !== expected.data) {
            return c.json(refusal("SYNC_STORE_CHANGED", "The sync store was deleted"), 409);
          }
        }
        if (usage.used + body.length > limits.accountBytes) {
          return c.json(refusal("SYNC_QUOTA", "The sync store of this account is full"), 409);
        }
        if (usage.databaseBytes > limits.databaseBytes) {
          return c.json(refusal("SYNC_STORE_FULL", "Sync is full, try again later"), 507);
        }
        const [inserted] = await db.batch([
          db
            .insert(syncChunk)
            .values({ userId, bytes: body, size: body.length })
            .returning({ id: syncChunk.id }),
          db.insert(hostingRecord).values({
            userId,
            operation: "create",
            submissionId: sql`'sync:' || last_insert_rowid()`,
            ...c.var.connection,
          }),
        ]);
        const [row] = inserted;
        if (!row) throw new Error("sync chunk stored without an id");
        const stored: StoredChunk = {
          id: row.id,
          used: usage.used + body.length,
          limit: limits.accountBytes,
          oldest: usage.oldest ?? row.id,
        };
        return c.json(stored, 201);
      },
    )
    .get("/chunks/next", async (c) => {
      const after = After.safeParse(c.req.query("after"));
      if (!after.success) {
        return c.json(refusal("INVALID_REQUEST", "Expected the id of the last chunk read"), 400);
      }
      const { userId } = c.var;
      const [chunk] = await database(c.env.DB)
        .select()
        .from(syncChunk)
        .where(and(eq(syncChunk.userId, userId), gt(syncChunk.id, after.data)))
        .orderBy(asc(syncChunk.id))
        .limit(1);
      const usage = await usageOf(c.env.DB, userId);
      c.header("cache-control", "no-store");
      c.header(SYNC_HEADERS.used, String(usage.used));
      if (usage.oldest !== null) c.header(SYNC_HEADERS.oldest, String(usage.oldest));
      if (!chunk) return c.body(null, 204);
      c.header(SYNC_HEADERS.id, String(chunk.id));
      c.header("content-type", "application/gzip");
      return c.body(chunk.bytes);
    })
    .delete("/chunks", async (c) => {
      const { userId } = c.var;
      const db = database(c.env.DB);
      const { oldest } = await usageOf(c.env.DB, userId);
      if (oldest !== null) {
        await db.batch([
          db.delete(syncChunk).where(eq(syncChunk.userId, userId)),
          db
            .insert(hostingRecord)
            .values(hostingRow(userId, "sync:all", "delete", c.var.connection)),
        ]);
      }
      return c.body(null, 204);
    });
