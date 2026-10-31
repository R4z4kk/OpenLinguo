import { asc, gte } from "drizzle-orm";
import { type Database, jobRun } from "./schema.ts";

const STALE_AFTER_MS = 26 * 60 * 60 * 1000;

/** The jobs whose latest run failed or that have not succeeded for 26 hours. */
export const unhealthyJobs = async (
  db: Database,
  jobs: readonly string[],
  now: Date,
): Promise<string[]> => {
  const recent = await db
    .select({ job: jobRun.job, status: jobRun.status })
    .from(jobRun)
    .where(gte(jobRun.finishedAt, new Date(now.getTime() - STALE_AFTER_MS)))
    .orderBy(asc(jobRun.finishedAt), asc(jobRun.id));
  const latest = new Map(recent.map(({ job, status }) => [job, status]));
  return jobs.filter((job) => latest.get(job) !== "succeeded");
};
