import { PUBLISHED_CHOICES } from "@openlinguo/core/account";
import {
  DECISION_SOURCES,
  GROUNDS,
  NOTICE_OUTCOMES,
  NOTICE_REASONS,
  RESTRICTIONS,
} from "@openlinguo/core/moderation";
import { LICENCES, SUBMISSION_STATUSES, type Submission } from "@openlinguo/core/submission";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** One row per run of a daily job, read by `GET /api/health`. */
export const jobRun = sqliteTable(
  "job_run",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    job: text().notNull(),
    startedAt: integer({ mode: "timestamp_ms" }).notNull(),
    finishedAt: integer({ mode: "timestamp_ms" }).notNull(),
    status: text({ enum: ["succeeded", "failed"] }).notNull(),
  },
  (table) => [check("job_run_status", sql`${table.status} in ('succeeded', 'failed')`)],
);

const createdAt = () =>
  integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  integer({ mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

/** Better Auth's tables (models `user`, `session`, `account`, `verification`, `rateLimit`, `twoFactor`). */
export const user = sqliteTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer({ mode: "boolean" }).notNull().default(false),
  image: text(),
  ageDeclaredAt: integer({ mode: "timestamp_ms" }),
  role: text(),
  banned: integer({ mode: "boolean" }).default(false),
  banReason: text(),
  banExpires: integer({ mode: "timestamp_ms" }),
  twoFactorEnabled: integer({ mode: "boolean" }).default(false),
  /** The latest session use, copied daily by the inactivity job; `null` means `createdAt`. */
  activeAt: integer({ mode: "timestamp_ms" }),
  inactivityNoticeAt: integer({ mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = sqliteTable("session", {
  id: text().primaryKey(),
  expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
  token: text().notNull().unique(),
  ipAddress: text(),
  userAgent: text(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  impersonatedBy: text(),
  twoFactorVerifiedAt: integer({ mode: "timestamp_ms" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const account = sqliteTable("account", {
  id: text().primaryKey(),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: integer({ mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer({ mode: "timestamp_ms" }),
  scope: text(),
  password: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const verification = sqliteTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: integer({ mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const rateLimit = sqliteTable("rate_limit", {
  id: text().primaryKey(),
  key: text().notNull().unique(),
  count: integer().notNull(),
  lastRequest: integer().notNull(),
});

/** One row per sign-in code sent, by a keyed hash of the address, for its daily cap (#289). */
export const codeRequest = sqliteTable(
  "code_request",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    /** HMAC-SHA-256 of the lowercased address with `BETTER_AUTH_SECRET`, in hex. */
    emailHash: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("code_request_email_hash").on(table.emailHash, table.createdAt)],
);

export const twoFactor = sqliteTable(
  "two_factor",
  {
    id: text().primaryKey(),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: integer({ mode: "boolean" }).default(true),
    failedVerificationCount: integer().default(0),
    lockedUntil: integer({ mode: "timestamp_ms" }),
  },
  (table) => [index("two_factor_user_id").on(table.userId)],
);

export const SECURITY_EVENT_TYPES = [
  "sign_in",
  "sign_in_failed",
  "code_sent",
  "second_factor",
  "second_factor_failed",
  "admin_action",
] as const;

/** Sign-ins, failures, codes sent, second factors and admin actions (ADR 0015), kept 6 months. */
export const securityEvent = sqliteTable(
  "security_event",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    type: text({ enum: SECURITY_EVENT_TYPES }).notNull(),
    /** The sign-in method, the second factor or the admin operation. */
    method: text().notNull(),
    userId: text().references(() => user.id, { onDelete: "set null" }),
    ipAddress: text(),
    userAgent: text(),
    reason: text(),
    target: text(),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "security_event_type",
      sql`${table.type} in ('sign_in', 'sign_in_failed', 'code_sent', 'second_factor', 'second_factor_failed', 'admin_action')`,
    ),
  ],
);

const LICENCE_IDS = [LICENCES.human, LICENCES.ai] as const;

/** A text sent to the shared library (ADR 0015); the licence follows the origin. */
export const submission = sqliteTable(
  "submission",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text().notNull(),
    body: text().notNull(),
    origin: text({ enum: ["human", "ai"] }).notNull(),
    provenance: text({ mode: "json" }).$type<NonNullable<Submission["provenance"]>>(),
    licence: text({ enum: LICENCE_IDS }).notNull(),
    attribution: text(),
    attestationVersion: integer().notNull(),
    attestedAt: integer({ mode: "timestamp_ms" }).notNull(),
    status: text({ enum: SUBMISSION_STATUSES }).notNull().default("pending"),
    /** HSK 2025 band estimated in the admin's browser at approval (ADR 0015). */
    band: integer(),
    publishedAt: integer({ mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("submission_user_status").on(table.userId, table.status),
    check(
      "submission_origin",
      sql`(${table.origin} = 'human' and ${table.provenance} is null and ${table.licence} = 'CC-BY-SA-4.0') or (${table.origin} = 'ai' and ${table.provenance} is not null and ${table.licence} = 'CC0-1.0')`,
    ),
    check(
      "submission_status",
      sql`${table.status} in ('pending', 'approved', 'rejected', 'removed')`,
    ),
  ],
);

/** A statement of reasons (DSA art. 17(3)) for a rejection or a removal, mailed to the submitter. */
export const decision = sqliteTable(
  "decision",
  {
    id: text().primaryKey(),
    submissionId: text()
      .notNull()
      .references(() => submission.id, { onDelete: "cascade" }),
    measure: text({ enum: RESTRICTIONS }).notNull(),
    source: text({ enum: DECISION_SOURCES }).notNull(),
    ground: text({ enum: GROUNDS }).notNull(),
    facts: text().notNull(),
    explanation: text().notNull(),
    decidedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("decision_submission").on(table.submissionId),
    check("decision_measure", sql`${table.measure} in ('rejected', 'removed')`),
    check("decision_source", sql`${table.source} in ('own-initiative', 'notice')`),
  ],
);

/** A notice of DSA art. 16 and the decision told to its notifier (16(5)). */
export const notice = sqliteTable(
  "notice",
  {
    id: text().primaryKey(),
    submissionId: text()
      .notNull()
      .references(() => submission.id, { onDelete: "cascade" }),
    reason: text({ enum: NOTICE_REASONS }).notNull(),
    explanation: text().notNull(),
    name: text(),
    email: text(),
    createdAt: createdAt(),
    outcome: text({ enum: NOTICE_OUTCOMES }),
    reply: text(),
    decidedAt: integer({ mode: "timestamp_ms" }),
  },
  (table) => [
    index("notice_submission").on(table.submissionId),
    check(
      "notice_reason",
      sql`${table.reason} in ('copyright', 'defamation', 'hate', 'personal-data', 'child-sexual-abuse', 'serious-offences', 'library-rules')`,
    ),
    check(
      "notice_decision",
      sql`(${table.outcome} is null and ${table.reply} is null and ${table.decidedAt} is null) or (${table.outcome} in ('kept', 'removed') and ${table.reply} is not null and ${table.decidedAt} is not null)`,
    ),
  ],
);

export const HOSTING_OPERATIONS = ["create", "edit", "delete"] as const;

/**
 * Décret 2021-1362 arts 5 to 7 (read on Légifrance 2026-10-31): kept 1 year, read only by the jobs
 * and the admin export for an authority. No foreign key: it outlives the text and the account.
 */
export const hostingRecord = sqliteTable(
  "hosting_record",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    userId: text().notNull(),
    submissionId: text().notNull(),
    operation: text({ enum: HOSTING_OPERATIONS }).notNull(),
    ipAddress: text(),
    /** Cloudflare does not pass the source port to Functions (request.cf, docs of 2026-10-18). */
    port: integer(),
    /** Art. 5 2° b: HTTP version and TLS version, such as `HTTP/2 TLSv1.3`. */
    protocol: text(),
    createdAt: createdAt(),
  },
  (table) => [
    check("hosting_record_operation", sql`${table.operation} in ('create', 'edit', 'delete')`),
  ],
);

/**
 * Holds the published texts a deleted account chose to keep (ADR 0015): no person, no session, an
 * `.invalid` address that cannot receive a code. The retention jobs (#278) must never delete it.
 */
export const DELETED_ACCOUNT = {
  id: "deleted-account",
  name: "",
  email: "deleted-account@openlinguo.invalid",
  ageDeclaredAt: new Date(0),
} as const;

/**
 * Décret 2021-1362 arts 2 and 3, for a deleted account that submitted: the email for 5 years, the
 * pseudonyms for 1 year. Read only by the jobs and the admin export for an authority.
 */
export const sealedIdentity = sqliteTable("sealed_identity", {
  userId: text().primaryKey(),
  email: text().notNull(),
  emailUntil: integer({ mode: "timestamp_ms" }).notNull(),
  /** `null` once the year is over. */
  pseudonyms: text({ mode: "json" }).$type<string[]>(),
  pseudonymsUntil: integer({ mode: "timestamp_ms" }).notNull(),
  sealedAt: createdAt(),
});

/**
 * Accounts deleted in the last 8 days, deleted again after a D1 Time Travel restore (EDPB CEF 2025
 * report on erasure), with the learner's choice and the connection the décret records.
 */
export const erasure = sqliteTable(
  "erasure",
  {
    userId: text().primaryKey(),
    published: text({ enum: PUBLISHED_CHOICES }).notNull(),
    ipAddress: text(),
    protocol: text(),
    erasedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "erasure_published",
      sql`${table.published} in ('keep-named', 'keep-anonymous', 'remove')`,
    ),
  ],
);

export const database = (d1: D1Database) => drizzle(d1, { casing: "snake_case" });
export type Database = ReturnType<typeof database>;
