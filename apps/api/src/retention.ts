import { and, eq, isNotNull, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { accountDeletion } from "./account.ts";
import type { Job, Outbox } from "./jobs.ts";
import { inactivityNoticeMail } from "./mail-templates.ts";
import {
  DELETED_ACCOUNT,
  decision,
  hostingRecord,
  notice,
  rateLimit,
  sealedIdentity,
  securityEvent,
  session,
  user,
  verification,
} from "./schema.ts";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const NOTICE_DAYS = 30;

const monthsBefore = (now: Date, months: number) => {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
};

/** ADR 0015's periods (docs/compliance/retention-schedule.md): rows older than these go. */
export const cutoffs = (now: Date) => ({
  securityEvents: monthsBefore(now, 6),
  /** The longest window of Better Auth's rules (auth.ts) and of the notices. */
  rateLimits: new Date(now.getTime() - 10 * MINUTE_MS),
  undeclaredAccounts: new Date(now.getTime() - DAY_MS),
  hostingRecords: monthsBefore(now, 12),
  moderation: monthsBefore(now, 12),
  inactive: monthsBefore(now, 24),
  noticeGrace: new Date(now.getTime() - NOTICE_DAYS * DAY_MS),
});

export type InactivityStep = "none" | "notify" | "delete";

/** 2 years unused: an email, then the deletion 30 days later unless the account is used again. */
export const inactivityStep = (
  activeAt: Date,
  noticeAt: Date | null,
  now: Date,
): InactivityStep => {
  const { inactive, noticeGrace } = cutoffs(now);
  if (activeAt > inactive) return "none";
  if (noticeAt === null || noticeAt <= activeAt) return "notify";
  return noticeAt <= noticeGrace ? "delete" : "none";
};

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const inactiveAccounts: Job = {
  name: "inactive-accounts",
  run: async ({ db, now, outbox }) => {
    // Better Auth moves a session's `updated_at` at most once a day of use.
    await db.run(sql`update "user" set "active_at" = max(
      coalesce("active_at", "created_at"),
      coalesce((select max(s."updated_at") from "session" s where s."user_id" = "user"."id"), 0))`);
    const candidates = await db
      .select({
        id: user.id,
        email: user.email,
        activeAt: user.activeAt,
        createdAt: user.createdAt,
        noticeAt: user.inactivityNoticeAt,
      })
      .from(user)
      .where(
        and(
          ne(user.id, DELETED_ACCOUNT.id),
          isNotNull(user.ageDeclaredAt),
          lte(user.activeAt, cutoffs(now).inactive),
        ),
      )
      .orderBy(user.id);
    let mail: Outbox | null = null;
    const failures: string[] = [];
    for (const { id, email, activeAt, createdAt, noticeAt } of candidates) {
      const step = inactivityStep(activeAt ?? createdAt, noticeAt, now);
      if (step === "delete") {
        const nobody = { ipAddress: null, protocol: null };
        const [first, ...rest] =
          (await accountDeletion(db, id, "keep-anonymous", nobody, now)) ?? [];
        if (first) await db.batch([first, ...rest]);
      } else if (step === "notify") {
        try {
          mail ??= outbox();
          const deletionOn = new Date(now.getTime() + NOTICE_DAYS * DAY_MS);
          const sent = await mail.sendMail(inactivityNoticeMail(email, deletionOn, mail.appUrl));
          if (sent.ok) {
            await db.update(user).set({ inactivityNoticeAt: now }).where(eq(user.id, id));
          } else failures.push(`${id}: ${sent.error.message}`);
        } catch (error) {
          failures.push(`${id}: ${reason(error)}`);
        }
      }
    }
    if (failures.length > 0) {
      throw new Error(`Inactivity notice not sent to ${failures.join("; ")}`);
    }
  },
};

/** No API route answers before the age step, so these accounts hold nothing but themselves. */
export const purgeUndeclaredAccounts: Job = {
  name: "purge-undeclared-accounts",
  run: async ({ db, now }) => {
    await db
      .delete(user)
      .where(and(isNull(user.ageDeclaredAt), lt(user.createdAt, cutoffs(now).undeclaredAccounts)));
  },
};

export const purgeExpiredAuth: Job = {
  name: "purge-expired-auth",
  run: async ({ db, now }) => {
    await db.batch([
      db.delete(session).where(lt(session.expiresAt, now)),
      db.delete(verification).where(lt(verification.expiresAt, now)),
      db.delete(rateLimit).where(lt(rateLimit.lastRequest, cutoffs(now).rateLimits.getTime())),
    ]);
  },
};

export const purgeSecurityEvents: Job = {
  name: "purge-security-events",
  run: async ({ db, now }) => {
    await db.delete(securityEvent).where(lt(securityEvent.createdAt, cutoffs(now).securityEvents));
  },
};

/** Décret 2021-1362: connection records 1 year (art. 5), sealed identities at their own end. */
export const purgeHostingRetention: Job = {
  name: "purge-hosting-retention",
  run: async ({ db, now }) => {
    await db.batch([
      db.delete(hostingRecord).where(lt(hostingRecord.createdAt, cutoffs(now).hostingRecords)),
      db
        .update(sealedIdentity)
        .set({ pseudonyms: null })
        .where(and(isNotNull(sealedIdentity.pseudonyms), lt(sealedIdentity.pseudonymsUntil, now))),
      db.delete(sealedIdentity).where(lt(sealedIdentity.emailUntil, now)),
    ]);
  },
};

/** Statements of reasons and decided notices, 1 year after the decision; open notices stay. */
export const purgeModerationRecords: Job = {
  name: "purge-moderation-records",
  run: async ({ db, now }) => {
    const { moderation } = cutoffs(now);
    await db.batch([
      db.delete(decision).where(lt(decision.decidedAt, moderation)),
      db.delete(notice).where(lt(notice.decidedAt, moderation)),
    ]);
  },
};
