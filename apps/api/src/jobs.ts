import { type Database, jobRun } from "./schema.ts";

export type Job = { readonly name: string; readonly run: (db: Database) => Promise<void> };

/** The daily jobs, run by the cron Worker and checked by `GET /api/health`. */
export const JOBS: readonly Job[] = [];

export const runJobs = async (db: Database, jobs: readonly Job[]): Promise<void> => {
  for (const job of jobs) {
    const startedAt = new Date();
    let status: "succeeded" | "failed" = "succeeded";
    try {
      await job.run(db);
    } catch (error) {
      status = "failed";
      console.error(`job ${job.name} failed`, error);
    }
    await db.insert(jobRun).values({ job: job.name, startedAt, finishedAt: new Date(), status });
  }
};
