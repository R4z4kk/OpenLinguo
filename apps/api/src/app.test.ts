import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { database, jobRun } from "./schema.ts";
import { migratedPlatform } from "./testing/platform.ts";

const HOUR = 60 * 60 * 1000;
const platform = await migratedPlatform();
const db = database(platform.env.DB);
afterAll(() => platform.dispose());
beforeEach(async () => {
  await db.delete(jobRun);
});

const recordRun = async (job: string, status: "succeeded" | "failed", hoursAgo: number) => {
  const finishedAt = new Date(Date.now() - hoursAgo * HOUR);
  await db.insert(jobRun).values({ job, status, startedAt: finishedAt, finishedAt });
};

const health = (jobs: readonly string[]) =>
  createApp(jobs).request("/api/health", {}, platform.env);

describe("GET /api/health", () => {
  it("answers 200 with no job registered", async () => {
    const response = await health([]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("answers 200 when every job last succeeded within 26 hours", async () => {
    await recordRun("purge-sessions", "failed", 30);
    await recordRun("purge-sessions", "succeeded", 25);
    await recordRun("purge-events", "succeeded", 1);
    expect((await health(["purge-sessions", "purge-events"])).status).toBe(200);
  });

  it("answers 503 naming the jobs whose last run failed, is too old or never happened", async () => {
    await recordRun("purge-sessions", "succeeded", 2);
    await recordRun("purge-sessions", "failed", 1);
    await recordRun("purge-events", "succeeded", 27);
    await recordRun("purge-codes", "succeeded", 1);
    const response = await health([
      "purge-sessions",
      "purge-events",
      "purge-codes",
      "purge-notices",
    ]);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: "UNHEALTHY",
      message: "Jobs failed or overdue: purge-sessions, purge-events, purge-notices",
    });
  });
});

describe("security headers", () => {
  it("are set on every response, errors included", async () => {
    const response = await createApp([]).request("/api/nope", {}, platform.env);
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("errors", () => {
  it("answers 404 NOT_FOUND for an unknown route", async () => {
    const response = await createApp([]).request("/api/nope", {}, platform.env);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "NOT_FOUND",
      message: "No route for GET /api/nope",
    });
  });

  it("answers 500 INTERNAL without leaking the error, which is logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => null);
    const app = createApp([]);
    app.get("/boom", () => {
      throw new Error("secret detail");
    });
    const response = await app.request("/api/boom", {}, platform.env);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "INTERNAL", message: "Internal error" });
    expect(error).toHaveBeenCalledWith(new Error("secret detail"));
  });
});
