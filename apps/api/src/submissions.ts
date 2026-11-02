import type { ApiError } from "@openlinguo/core/api-error";
import {
  LICENCES,
  MAX_PENDING_SUBMISSIONS,
  NewSubmission,
  Submission,
} from "@openlinguo/core/submission";
import { and, count, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Auth } from "./auth.ts";
import { database, type HOSTING_OPERATIONS, hostingRecord, submission, user } from "./schema.ts";

type Routes = {
  Bindings: Env;
  Variables: { readonly userId: string; readonly userName: string };
};

const refusal = (code: ApiError["code"], message: string): ApiError => ({ code, message });

const toSubmission = (row: typeof submission.$inferSelect): Submission =>
  Submission.parse({
    ...row,
    attestedAt: row.attestedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  });

export type Connection = { readonly ipAddress: string | null; readonly protocol: string | null };

/** The connection identifier and protocols of décret 2021-1362 art. 5 2°. */
export const connectionOf = (request: Request): Connection => {
  const cf = request.cf;
  const protocol = [cf?.["httpProtocol"], cf?.["tlsVersion"]].filter(
    (part): part is string => typeof part === "string" && part !== "",
  );
  return {
    ipAddress: request.headers.get("cf-connecting-ip"),
    protocol: protocol.length > 0 ? protocol.join(" ") : null,
  };
};

/** One operation on a text, for `hosting_record`. */
export const hostingRow = (
  userId: string,
  submissionId: string,
  operation: (typeof HOSTING_OPERATIONS)[number],
  { ipAddress, protocol }: Connection,
) => ({ userId, submissionId, operation, ipAddress, port: null, protocol });

/** `/api/submissions`: the signed-in learner's texts sent to the shared library (ADR 0015). */
export const submissionRoutes = (authOf: (env: Env) => Auth) =>
  new Hono<Routes>()
    .use(async (c, next) => {
      const current = await authOf(c.env).api.getSession({ headers: c.req.raw.headers });
      if (!current) return c.json(refusal("UNAUTHORIZED", "Sign in first"), 401);
      c.set("userId", current.user.id);
      c.set("userName", current.user.name);
      return next();
    })
    .get("/", async (c) => {
      const rows = await database(c.env.DB)
        .select()
        .from(submission)
        .where(eq(submission.userId, c.var.userId))
        .orderBy(desc(submission.createdAt));
      return c.json(rows.map(toSubmission));
    })
    .post("/", async (c) => {
      const parsed = NewSubmission.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        const fields = [...new Set(parsed.error.issues.map(({ path }) => path.join(".")))];
        return c.json(refusal("INVALID_REQUEST", `Invalid fields: ${fields.join(", ")}`), 400);
      }
      const db = database(c.env.DB);
      const [pending] = await db
        .select({ total: count() })
        .from(submission)
        .where(and(eq(submission.userId, c.var.userId), eq(submission.status, "pending")));
      if ((pending?.total ?? 0) >= MAX_PENDING_SUBMISSIONS) {
        const message = `At most ${String(MAX_PENDING_SUBMISSIONS)} texts pending review`;
        return c.json(refusal("SUBMISSION_LIMIT", message), 409);
      }
      const { attribution, ...draft } = parsed.data;
      const name = attribution.kind === "pseudonym" ? attribution.name : null;
      const now = new Date();
      const row = {
        ...draft,
        id: crypto.randomUUID(),
        userId: c.var.userId,
        licence: LICENCES[draft.origin],
        attribution: name,
        attestedAt: now,
        status: "pending" as const,
        band: null,
        publishedAt: null,
        createdAt: now,
      };
      const created = db.insert(submission).values(row);
      const recorded = db
        .insert(hostingRecord)
        .values(hostingRow(c.var.userId, row.id, "create", connectionOf(c.req.raw)));
      if (name !== null && c.var.userName === "") {
        const named = db.update(user).set({ name }).where(eq(user.id, c.var.userId));
        await db.batch([created, recorded, named]);
      } else {
        await db.batch([created, recorded]);
      }
      return c.json(toSubmission(row), 201);
    })
    .delete("/:id", async (c) => {
      const db = database(c.env.DB);
      const id = c.req.param("id");
      const mine = and(eq(submission.id, id), eq(submission.userId, c.var.userId));
      const [found] = await db.select({ status: submission.status }).from(submission).where(mine);
      if (!found) return c.json(refusal("NOT_FOUND", "No such submission"), 404);
      if (found.status !== "pending") {
        return c.json(refusal("SUBMISSION_NOT_PENDING", "Only a pending text is withdrawn"), 409);
      }
      await db.batch([
        db.delete(submission).where(and(mine, eq(submission.status, "pending"))),
        db
          .insert(hostingRecord)
          .values(hostingRow(c.var.userId, id, "delete", connectionOf(c.req.raw))),
      ]);
      return c.body(null, 204);
    });
