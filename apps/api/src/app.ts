import type { ApiError } from "@openlinguo/core/api-error";
import { Hono } from "hono";
import { unhealthyJobs } from "./health.ts";
import { JOBS } from "./jobs.ts";
import { database } from "./schema.ts";

export const createApp = (jobs: readonly string[]) => {
  const app = new Hono<{ Bindings: Env }>().basePath("/api");

  app.get("/health", async (c) => {
    const unhealthy = await unhealthyJobs(database(c.env.DB), jobs, new Date());
    if (unhealthy.length > 0) {
      const body = {
        code: "UNHEALTHY",
        message: `Jobs failed or overdue: ${unhealthy.join(", ")}`,
      } satisfies ApiError;
      return c.json(body, 503);
    }
    return c.json({ status: "ok" });
  });

  app.notFound((c) =>
    c.json(
      {
        code: "NOT_FOUND",
        message: `No route for ${c.req.method} ${c.req.path}`,
      } satisfies ApiError,
      404,
    ),
  );

  app.onError((error, c) => {
    console.error(error);
    return c.json({ code: "INTERNAL", message: "Internal error" } satisfies ApiError, 500);
  });

  return app;
};

export const app = createApp(JOBS.map(({ name }) => name));
