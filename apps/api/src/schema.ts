import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const database = (d1: D1Database) => drizzle(d1, { casing: "snake_case" });
export type Database = ReturnType<typeof database>;
