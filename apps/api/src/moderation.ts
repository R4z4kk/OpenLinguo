import { AdminAccountDeletion } from "@openlinguo/core/account";
import type { ApiError } from "@openlinguo/core/api-error";
import {
  Approval,
  type DECISION_SOURCES,
  KeepNotice,
  NewStatementOfReasons,
  Notice,
  type NoticeDecided,
  type Restriction,
  type StatementOfReasons,
} from "@openlinguo/core/moderation";
import { ok } from "@openlinguo/core/result";
import { Submission } from "@openlinguo/core/submission";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { type Context, Hono } from "hono";
import { accountDeletion, isDeletedAccount } from "./account.ts";
import type { Auth } from "./auth.ts";
import type { SendMail } from "./mail.ts";
import { noticeDecisionMail, statementOfReasonsMail } from "./mail-templates.ts";
import { database, decision, notice, securityEvent, submission, user } from "./schema.ts";
import { connectionOf } from "./submissions.ts";

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

const DECIDED = refusal("NOTICE_DECIDED", "This notice is already decided");

const toNotice = (row: typeof notice.$inferSelect & { readonly title: string }): Notice =>
  Notice.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    decision:
      row.outcome === null || row.reply === null || row.decidedAt === null
        ? null
        : { outcome: row.outcome, reply: row.reply, decidedAt: row.decidedAt.toISOString() },
  });

const noticeColumns = {
  id: notice.id,
  submissionId: notice.submissionId,
  reason: notice.reason,
  explanation: notice.explanation,
  name: notice.name,
  email: notice.email,
  createdAt: notice.createdAt,
  outcome: notice.outcome,
  reply: notice.reply,
  decidedAt: notice.decidedAt,
  title: submission.title,
};

type Notified = { readonly id: string; readonly email: string | null };

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
    id: string,
    from: keyof typeof NOT_IN_STATE,
    measure: Restriction,
    source: (typeof DECISION_SOURCES)[number],
    also: (decidedAt: Date, explanation: string) => BatchItem<"sqlite">[] = () => [],
  ): Promise<Response | StatementOfReasons> => {
    const parsed = NewStatementOfReasons.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return invalid(c, parsed.error.issues);
    const db = database(c.env.DB);
    const [found] = await db
      .select({
        title: submission.title,
        status: submission.status,
        email: user.email,
        userId: user.id,
      })
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
      source,
      decidedAt,
    };
    const statement: StatementOfReasons = {
      ...stored,
      automated: false,
      decidedAt: decidedAt.toISOString(),
    };
    const { sendMail, contact } = moderationOf(c.env);
    // A text kept by a deleted account has no one to tell.
    const sent = isDeletedAccount(found.userId)
      ? ok(null)
      : await sendMail(statementOfReasonsMail(found.email, found.title, statement, contact));
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
      ...also(decidedAt, parsed.data.explanation),
    ]);
    return statement;
  };

  const own = async (c: Context<Routes>, from: keyof typeof NOT_IN_STATE, measure: Restriction) => {
    const decided = await restrict(c, c.req.param("id") ?? "", from, measure, "own-initiative");
    return decided instanceof Response ? decided : c.json(decided, 201);
  };

  /** 16(5): each notifier with an email gets the decision; failures go back to the admin. */
  const tellNotifiers = async (
    c: Context<Routes>,
    notified: readonly Notified[],
    facts: Omit<Parameters<typeof noticeDecisionMail>[1], "id">,
    decided: Parameters<typeof noticeDecisionMail>[2],
  ) => {
    const { sendMail, contact } = moderationOf(c.env);
    const unsent: string[] = [];
    for (const { id, email } of notified) {
      if (email === null) continue;
      const sent = await sendMail(noticeDecisionMail(email, { ...facts, id }, decided, contact));
      if (!sent.ok) {
        console.error("notice decision not sent", sent.error);
        unsent.push(email);
      }
    }
    return unsent;
  };

  const findNotice = async (c: Context<Routes>) => {
    const [found] = await database(c.env.DB)
      .select(noticeColumns)
      .from(notice)
      .innerJoin(submission, eq(submission.id, notice.submissionId))
      .where(eq(notice.id, c.req.param("id") ?? ""));
    return found ?? null;
  };

  return (
    new Hono<Routes>()
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
      // The requests runbook decides when; published texts stay without a name, the default choice.
      .post("/accounts/delete", async (c) => {
        const parsed = AdminAccountDeletion.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) return invalid(c, parsed.error.issues);
        const db = database(c.env.DB);
        const [found] = await db
          .select({ id: user.id, role: user.role })
          .from(user)
          .where(eq(user.email, parsed.data.email.toLowerCase()));
        if (!found) return c.json(refusal("NOT_FOUND", "No account with this address"), 404);
        if (found.role === "admin" || isDeletedAccount(found.id)) {
          return c.json(refusal("INVALID_REQUEST", "This account is not deleted here"), 400);
        }
        const writes = await accountDeletion(
          db,
          found.id,
          "keep-anonymous",
          connectionOf(c.req.raw),
          new Date(),
        );
        if (writes === null)
          return c.json(refusal("NOT_FOUND", "No account with this address"), 404);
        await db.batch([
          db.insert(securityEvent).values(adminAction(c, "delete-account", found.id)),
          ...writes,
        ]);
        return c.body(null, 204);
      })
      .post("/submissions/:id/reject", (c) => own(c, "pending", "rejected"))
      .post("/submissions/:id/remove", (c) => own(c, "approved", "removed"))
      .get("/notices", async (c) => {
        const rows = await database(c.env.DB)
          .select(noticeColumns)
          .from(notice)
          .innerJoin(submission, eq(submission.id, notice.submissionId))
          .orderBy(sql`${notice.decidedAt} is not null`, asc(notice.createdAt));
        return c.json(rows.map(toNotice));
      })
      .get("/notices/:id", async (c) => {
        const found = await findNotice(c);
        return found
          ? c.json(toNotice(found))
          : c.json(refusal("NOT_FOUND", "No such notice"), 404);
      })
      .post("/notices/:id/keep", async (c) => {
        const parsed = KeepNotice.safeParse(await c.req.json().catch(() => null));
        if (!parsed.success) return invalid(c, parsed.error.issues);
        const found = await findNotice(c);
        if (!found) return c.json(refusal("NOT_FOUND", "No such notice"), 404);
        if (found.outcome !== null) return c.json(DECIDED, 409);
        const db = database(c.env.DB);
        await db.batch([
          db
            .update(notice)
            .set({ outcome: "kept", reply: parsed.data.reply, decidedAt: new Date() })
            .where(and(eq(notice.id, found.id), isNull(notice.outcome))),
          db.insert(securityEvent).values(adminAction(c, "keep", found.id)),
        ]);
        const unsent = await tellNotifiers(
          c,
          [found],
          { title: found.title, reason: found.reason },
          { outcome: "kept", reply: parsed.data.reply },
        );
        return c.json({ unsent, statement: null } satisfies NoticeDecided);
      })
      .post("/notices/:id/remove", async (c) => {
        const found = await findNotice(c);
        if (!found) return c.json(refusal("NOT_FOUND", "No such notice"), 404);
        if (found.outcome !== null) return c.json(DECIDED, 409);
        const db = database(c.env.DB);
        const open = and(eq(notice.submissionId, found.submissionId), isNull(notice.outcome));
        const notified = await db
          .select({ id: notice.id, email: notice.email })
          .from(notice)
          .where(open);
        const decided = await restrict(
          c,
          found.submissionId,
          "approved",
          "removed",
          "notice",
          (decidedAt, reply) => [
            db.update(notice).set({ outcome: "removed", reply, decidedAt }).where(open),
          ],
        );
        if (decided instanceof Response) return decided;
        const unsent = await tellNotifiers(
          c,
          notified,
          { title: found.title, reason: found.reason },
          { outcome: "removed", reply: decided.explanation },
        );
        return c.json({ unsent, statement: decided } satisfies NoticeDecided, 201);
      })
  );
};
