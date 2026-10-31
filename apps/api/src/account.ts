import { AccountDeletion, AccountExport, type PublishedChoice } from "@openlinguo/core/account";
import type { ApiError } from "@openlinguo/core/api-error";
import { StatementOfReasons } from "@openlinguo/core/moderation";
import { Submission } from "@openlinguo/core/submission";
import { count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import type { Auth } from "./auth.ts";
import type { Job } from "./jobs.ts";
import {
  account,
  DELETED_ACCOUNT,
  type Database,
  database,
  decision,
  erasure,
  hostingRecord,
  sealedIdentity,
  securityEvent,
  session,
  submission,
  user,
  verification,
} from "./schema.ts";
import { type Connection, connectionOf, hostingRow } from "./submissions.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Décret 2021-1362: identity 5 years (art. 2), pseudonyms 1 year (art. 3) after the contract. */
const SEALED_EMAIL_DAYS = 5 * 365;
const SEALED_PSEUDONYM_DAYS = 365;
/** Longer than D1 Time Travel's 7 days on the Workers Free plan (retention schedule). */
const ERASURE_LOG_DAYS = 8;

const refusal = (code: ApiError["code"], message: string): ApiError => ({ code, message });

const iso = (date: Date) => date.toISOString();

/**
 * Every write that deletes `userId`, in one D1 batch; `null` when the account is already gone.
 * Kept texts move to the placeholder account; the others are deleted with a décret record each.
 */
export const accountDeletion = async (
  db: Database,
  userId: string,
  published: PublishedChoice,
  connection: Connection,
  now: Date,
): Promise<BatchItem<"sqlite">[] | null> => {
  const [found] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, userId));
  if (!found) return null;
  const texts = await db
    .select({ id: submission.id, status: submission.status, attribution: submission.attribution })
    .from(submission)
    .where(eq(submission.userId, userId));
  const [recorded] = await db
    .select({ total: count() })
    .from(hostingRecord)
    .where(eq(hostingRecord.userId, userId));
  const kept = published === "remove" ? [] : texts.filter(({ status }) => status === "approved");
  const keptIds = kept.map(({ id }) => id);
  const deleted = texts.filter(({ id }) => !keptIds.includes(id));
  const pseudonyms = [
    ...new Set([found.name, ...texts.map(({ attribution }) => attribution ?? "")]),
  ].filter((name) => name !== "");

  const writes: BatchItem<"sqlite">[] = [];
  if (kept.length > 0) {
    writes.push(
      db
        .insert(user)
        .values({ ...DELETED_ACCOUNT, emailVerified: false })
        .onConflictDoNothing(),
      db
        .update(submission)
        .set({
          userId: DELETED_ACCOUNT.id,
          ...(published === "keep-anonymous" ? { attribution: null } : {}),
        })
        .where(inArray(submission.id, keptIds)),
    );
  }
  const operations = [
    ...deleted.map(({ id }) => hostingRow(userId, id, "delete", connection)),
    ...(published === "keep-anonymous"
      ? kept
          .filter(({ attribution }) => attribution !== null)
          .map(({ id }) => hostingRow(userId, id, "edit", connection))
      : []),
  ];
  if (operations.length > 0) writes.push(db.insert(hostingRecord).values(operations));
  if (texts.length > 0 || (recorded?.total ?? 0) > 0) {
    const sealed = {
      email: found.email,
      emailUntil: new Date(now.getTime() + SEALED_EMAIL_DAYS * DAY_MS),
      pseudonyms: pseudonyms.length > 0 ? pseudonyms : null,
      pseudonymsUntil: new Date(now.getTime() + SEALED_PSEUDONYM_DAYS * DAY_MS),
    };
    writes.push(
      db
        .insert(sealedIdentity)
        .values({ userId, ...sealed, sealedAt: now })
        .onConflictDoUpdate({ target: sealedIdentity.userId, set: sealed }),
    );
  }
  writes.push(
    // Better Auth keys a pending code by `<type>-otp-<email>`.
    db
      .delete(verification)
      .where(sql`substr(${verification.identifier}, -${found.email.length}) = ${found.email}`),
    db.delete(user).where(eq(user.id, userId)),
    db
      .insert(erasure)
      .values({ userId, published, ...connection, erasedAt: now })
      .onConflictDoNothing(),
  );
  return writes;
};

const toExport = async (db: Database, userId: string, now: Date): Promise<AccountExport | null> => {
  const [found] = await db.select().from(user).where(eq(user.id, userId));
  if (!found) return null;
  const methods = await db
    .select({ providerId: account.providerId, createdAt: account.createdAt })
    .from(account)
    .where(eq(account.userId, userId));
  const sessions = await db
    .select({
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
    })
    .from(session)
    .where(eq(session.userId, userId));
  const texts = await db
    .select()
    .from(submission)
    .where(eq(submission.userId, userId))
    .orderBy(desc(submission.createdAt));
  const decisions = await db
    .select()
    .from(decision)
    .innerJoin(submission, eq(submission.id, decision.submissionId))
    .where(eq(submission.userId, userId));
  const events = await db
    .select({
      type: securityEvent.type,
      method: securityEvent.method,
      ipAddress: securityEvent.ipAddress,
      userAgent: securityEvent.userAgent,
      createdAt: securityEvent.createdAt,
    })
    .from(securityEvent)
    .where(eq(securityEvent.userId, userId))
    .orderBy(desc(securityEvent.createdAt));
  return AccountExport.parse({
    exportedAt: iso(now),
    account: {
      id: found.id,
      email: found.email,
      pseudonym: found.name === "" ? null : found.name,
      createdAt: iso(found.createdAt),
      ageDeclaredAt: found.ageDeclaredAt === null ? null : iso(found.ageDeclaredAt),
      role: found.role,
      twoFactorEnabled: found.twoFactorEnabled === true,
    },
    signInMethods: methods.map((method) => ({ ...method, createdAt: iso(method.createdAt) })),
    sessions: sessions.map((row) => ({
      ...row,
      createdAt: iso(row.createdAt),
      expiresAt: iso(row.expiresAt),
    })),
    submissions: texts.map((row) =>
      Submission.parse({ ...row, attestedAt: iso(row.attestedAt), createdAt: iso(row.createdAt) }),
    ),
    decisions: decisions.map(({ decision: row }) =>
      StatementOfReasons.parse({ ...row, automated: false, decidedAt: iso(row.decidedAt) }),
    ),
    securityEvents: events.map((event) => ({ ...event, createdAt: iso(event.createdAt) })),
  });
};

type Routes = { Bindings: Env; Variables: { readonly userId: string } };

/** `/api/account`: export and deletion of the signed-in account (GDPR arts 15, 17 and 20). */
export const accountRoutes = (authOf: (env: Env) => Auth) =>
  new Hono<Routes>()
    .use(async (c, next) => {
      const current = await authOf(c.env).api.getSession({ headers: c.req.raw.headers });
      if (!current) return c.json(refusal("UNAUTHORIZED", "Sign in first"), 401);
      c.set("userId", current.user.id);
      return next();
    })
    .get("/export", async (c) => {
      const exported = await toExport(database(c.env.DB), c.var.userId, new Date());
      if (!exported) return c.json(refusal("UNAUTHORIZED", "Sign in first"), 401);
      c.header("cache-control", "no-store");
      return c.json(exported);
    })
    .post("/delete", async (c) => {
      const parsed = AccountDeletion.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return c.json(refusal("INVALID_REQUEST", "Expected a choice for published texts"), 400);
      }
      const db = database(c.env.DB);
      const writes = await accountDeletion(
        db,
        c.var.userId,
        parsed.data.published,
        connectionOf(c.req.raw),
        new Date(),
      );
      if (writes === null) return c.json(refusal("UNAUTHORIZED", "Sign in first"), 401);
      const [first, ...rest] = writes;
      if (first) await db.batch([first, ...rest]);
      return c.body(null, 204);
    });

/** Runs each logged deletion again, so a Time Travel restore cannot bring an account back. */
export const reapplyErasures: Job = {
  name: "reapply-erasures",
  run: async (db) => {
    const now = new Date();
    await db
      .delete(erasure)
      .where(lt(erasure.erasedAt, new Date(now.getTime() - ERASURE_LOG_DAYS * DAY_MS)));
    for (const logged of await db.select().from(erasure)) {
      const writes = await accountDeletion(
        db,
        logged.userId,
        logged.published,
        { ipAddress: logged.ipAddress, protocol: logged.protocol },
        logged.erasedAt,
      );
      const [first, ...rest] = writes ?? [];
      if (first) await db.batch([first, ...rest]);
    }
  },
};

// Used by the moderation routes: no one to mail for a kept text of a deleted account.
export const isDeletedAccount = (userId: string): boolean => userId === DELETED_ACCOUNT.id;
