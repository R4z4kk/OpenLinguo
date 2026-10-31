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

export const database = (d1: D1Database) => drizzle(d1, { casing: "snake_case" });
export type Database = ReturnType<typeof database>;
