import { reapplyErasures } from "./account.ts";
import type { SendMail } from "./mail.ts";
import {
  inactiveAccounts,
  purgeExpiredAuth,
  purgeHostingRetention,
  purgeModerationRecords,
  purgeSecurityEvents,
  purgeUndeclaredAccounts,
} from "./retention.ts";
import { type Database, jobRun } from "./schema.ts";

export type Outbox = { readonly sendMail: SendMail; readonly appUrl: string };

/** `outbox` throws when the mail settings are missing, which fails only the job that mails. */
export type JobContext = {
  readonly db: Database;
  readonly now: Date;
  readonly outbox: () => Outbox;
};

export type Job = { readonly name: string; readonly run: (context: JobContext) => Promise<void> };

/** The daily jobs, run in this order by the cron Worker and checked by `GET /api/health`. */
export const JOBS: readonly Job[] = [
  reapplyErasures,
  // Before purgeExpiredAuth: it reads the sessions' last use.
  inactiveAccounts,
  purgeUndeclaredAccounts,
  purgeExpiredAuth,
  purgeSecurityEvents,
  purgeHostingRetention,
  purgeModerationRecords,
];

export const runJobs = async (context: JobContext, jobs: readonly Job[]): Promise<void> => {
  for (const job of jobs) {
    const startedAt = new Date();
    let status: "succeeded" | "failed" = "succeeded";
    try {
      await job.run(context);
    } catch (error) {
      status = "failed";
      console.error(`job ${job.name} failed`, error);
    }
    await context.db
      .insert(jobRun)
      .values({ job: job.name, startedAt, finishedAt: new Date(), status });
  }
};
