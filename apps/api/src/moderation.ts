import type { ApiError } from "@openlinguo/core/api-error";
import {
  Approval,
  NewStatementOfReasons,
  type Restriction,
  type StatementOfReasons,
} from "@openlinguo/core/moderation";
import { Submission } from "@openlinguo/core/submission";
import { and, asc, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import type { Auth } from "./auth.ts";
import type { SendMail } from "./mail.ts";
import { statementOfReasonsMail } from "./mail-templates.ts";
import { database, decision, securityEvent, submission, user } from "./schema.ts";

type Routes = { Bindings: Env; Variables: { readonly adminId: string } };

export type Moderation = { readonly sendMail: SendMail; readonly contact: string };

const refusal = (code: ApiError["code"], message: string): ApiError => ({ code, message });

const toSubmission = (row: typeof submission.$inferSelect): Submission =>
  Submission.parse({
    ...row,
    attestedAt: row.attestedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  });

const invalid = (c: Context<Routes>, issues: readonly { readonly path: PropertyKey[] }[]) => {
  const fields = [...new Set(issues.map(({ path }) => path.join(".")))];
  return c.json(refusal("INVALID_REQUEST", `Invalid fields: ${fields.join(", ")}`), 400);
};

const adminAction = (c: Context<Routes>, operation: string, target: string) => ({
  type: "admin_action" as const,
  method: `moderation/${operation}`,
  userId: c.var.adminId,
  ipAddress: c.req.header("cf-connecting-ip") ?? null,
  userAgent: c.req.header("user-agent") ?? null,
  reason: null,
  target,
});

const NOT_IN_STATE = {
  pending: refusal("SUBMISSION_NOT_PENDING", "Only a pending text is reviewed"),
  approved: refusal("SUBMISSION_NOT_APPROVED", "Only a published text is removed"),
} as const;

/**
 * `/api/admin`: the moderation queue (ADR 0015). The app's gate already requires the admin role
 * and a verified TOTP code; the level is estimated in the admin's browser and sent with approval.
 */
export const moderationRoutes = (
  authOf: (env: Env) => Auth,
  moderationOf: (env: Env) => Moderation,
) => {
  /** A statement of reasons is mailed before the measure is stored: a failed mail changes nothing. */
  const restrict = async (
    c: Context<Routes>,
    from: keyof typeof NOT_IN_STATE,
    measure: Restriction,
  ) => {
    const parsed = NewStatementOfReasons.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues);
    const db = database(c.env.DB);
    const id = c.req.param("id") ?? "";
    const [found] = await db
      .select({ title: submission.title, status: submission.status, email: user.email })
      .from(submission)
      .innerJoin(user, eq(user.id, submission.userId))
      .where(eq(submission.id, id));
    if (!found) return c.json(refusal("NOT_FOUND", "No such submission"), 404);
    if (found.status !== from) return c.json(NOT_IN_STATE[from], 409);
    const decidedAt = new Date();
    const stored = {
      ...parsed.data,
      id: crypto.randomUUID(),
      submissionId: id,
      measure,
      source: "own-initiative" as const,
      decidedAt,
    };
    const statement: StatementOfReasons = {
      ...stored,
      automated: false,
      decidedAt: decidedAt.toISOString(),
    };
    const { sendMail, contact } = moderationOf(c.env);
    const sent = await sendMail(
      statementOfReasonsMail(found.email, found.title, statement, contact),
    );
    if (!sent.ok) {
      console.error("statement of reasons not sent", sent.error);
      return c.json(refusal("MAIL_FAILED", "The statement of reasons could not be sent"), 502);
    }
    await db.batch([
      db
        .update(submission)
        .set({ status: measure })
        .where(and(eq(submission.id, id), eq(submission.status, from))),
      db.insert(decision).values(stored),
      db
        .insert(securityEvent)
        .values(adminAction(c, measure === "rejected" ? "reject" : "remove", id)),
    ]);
    return c.json(statement, 201);
  };

  return new Hono<Routes>()
    .use(async (c, next) => {
      const current = await authOf(c.env).api.getSession({ headers: c.req.raw.headers });
      if (!current) return c.json(refusal("UNAUTHORIZED", "Sign in first"), 401);
      c.set("adminId", current.user.id);
      return next();
    })
    .get("/queue", async (c) => {
      const rows = await database(c.env.DB)
        .select()
        .from(submission)
        .where(eq(submission.status, "pending"))
        .orderBy(asc(submission.createdAt));
      return c.json(rows.map(toSubmission));
    })
    .get("/submissions/:id", async (c) => {
      const [row] = await database(c.env.DB)
        .select()
        .from(submission)
        .where(eq(submission.id, c.req.param("id")));
      return row
        ? c.json(toSubmission(row))
        : c.json(refusal("NOT_FOUND", "No such submission"), 404);
    })
    .post("/submissions/:id/approve", async (c) => {
      const parsed = Approval.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return invalid(c, parsed.error.issues);
      const db = database(c.env.DB);
      const id = c.req.param("id");
      const [found] = await db
        .select({ status: submission.status })
        .from(submission)
        .where(eq(submission.id, id));
      if (!found) return c.json(refusal("NOT_FOUND", "No such submission"), 404);
      if (found.status !== "pending") return c.json(NOT_IN_STATE.pending, 409);
      await db.batch([
        db
          .update(submission)
          .set({ status: "approved", band: parsed.data.band, publishedAt: new Date() })
          .where(and(eq(submission.id, id), eq(submission.status, "pending"))),
        db.insert(securityEvent).values(adminAction(c, "approve", id)),
      ]);
      return c.body(null, 204);
    })
    .post("/submissions/:id/reject", (c) => restrict(c, "pending", "rejected"))
    .post("/submissions/:id/remove", (c) => restrict(c, "approved", "removed"));
};
