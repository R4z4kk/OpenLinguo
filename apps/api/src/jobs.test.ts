import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runJobs } from "./jobs.ts";
import { database, jobRun } from "./schema.ts";
import { migratedPlatform } from "./testing/platform.ts";

const platform = await migratedPlatform();
const db = database(platform.env.DB);
afterAll(() => platform.dispose());
beforeEach(async () => {
  await db.delete(jobRun);
});

describe("runJobs", () => {
  it("records each run, and a failure does not stop the next job", async () => {
    vi.spyOn(console, "error").mockImplementation(() => null);
    const ran: string[] = [];
    const before = Date.now();
    await runJobs(db, [
      {
        name: "breaks",
        run: () => Promise.reject(new Error("D1 timeout")),
      },
      {
        name: "purges",
        run: () => {
          ran.push("purges");
          return Promise.resolve();
        },
      },
    ]);
    const runs = await db.select().from(jobRun).orderBy(jobRun.id);
    expect(ran).toEqual(["purges"]);
    expect(runs.map(({ job, status }) => ({ job, status }))).toEqual([
      { job: "breaks", status: "failed" },
      { job: "purges", status: "succeeded" },
    ]);
    for (const run of runs) {
      expect(run.startedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(run.finishedAt.getTime()).toBeGreaterThanOrEqual(run.startedAt.getTime());
    }
    expect(console.error).toHaveBeenCalledWith("job breaks failed", new Error("D1 timeout"));
  });
});
