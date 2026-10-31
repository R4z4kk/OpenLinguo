import { AgeDeclaration } from "@openlinguo/core/account";
import type { ApiError } from "@openlinguo/core/api-error";
import { getSessionCookie } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { type Auth, AuthEnv, createAuth } from "./auth.ts";
import { unhealthyJobs } from "./health.ts";
import { JOBS } from "./jobs.ts";
import type { SendMail } from "./mail.ts";
import { scalewayMailer } from "./scaleway-mailer.ts";
import { database, user } from "./schema.ts";

export type Mailer = (env: AuthEnv) => SendMail;

const scaleway: Mailer = (env) =>
  scalewayMailer({
    secretKey: env.SCW_SECRET_KEY,
    projectId: env.SCW_PROJECT_ID,
    from: env.MAIL_FROM,
  });

/** Reachable before the age step is answered (ADR 0015). */
const BEFORE_AGE_STEP = new Set([
  "/api/account/age",
  "/api/auth/delete-user",
  "/api/auth/get-session",
  "/api/auth/sign-out",
]);

export const createApp = (jobs: readonly string[], mailer: Mailer = scaleway) => {
  const app = new Hono<{ Bindings: Env }>().basePath("/api");

  // Pages applies apps/web/public/_headers to static files only. HSTS matches it.
  app.use(
    secureHeaders({
      strictTransportSecurity: "max-age=63072000; includeSubDomains",
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    }),
  );

  const authOf = (env: Env): Auth => {
    const settings = AuthEnv.safeParse(env);
    if (!settings.success) {
      const names = settings.error.issues.map(({ path }) => path.join(".")).join(", ");
      throw new Error(`Auth settings missing or invalid: ${names}`);
    }
    return createAuth(database(env.DB), settings.data, mailer(settings.data));
  };

  app.use(async (c, next) => {
    if (!getSessionCookie(c.req.raw) || BEFORE_AGE_STEP.has(c.req.path)) return next();
    const current = await authOf(c.env).api.getSession({ headers: c.req.raw.headers });
    if (current && !current.user.ageDeclaredAt) {
      const body = {
        code: "AGE_DECLARATION_REQUIRED",
        message: "Answer the age step first",
      } satisfies ApiError;
      return c.json(body, 403);
    }
    return next();
  });

  app.on(["GET", "POST"], "/auth/*", (c) => authOf(c.env).handler(c.req.raw));

  app.post("/account/age", async (c) => {
    const auth = authOf(c.env);
    const current = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!current) {
      return c.json({ code: "UNAUTHORIZED", message: "Sign in first" } satisfies ApiError, 401);
    }
    const declaration = AgeDeclaration.safeParse(await c.req.json().catch(() => null));
    if (!declaration.success) {
      const body = {
        code: "INVALID_REQUEST",
        message: "Expected an age answer",
      } satisfies ApiError;
      return c.json(body, 400);
    }
    const db = database(c.env.DB);
    if (declaration.data.answer === "under-15") {
      await db.delete(user).where(eq(user.id, current.user.id));
      return auth.api.signOut({ headers: c.req.raw.headers, asResponse: true });
    }
    await db.update(user).set({ ageDeclaredAt: new Date() }).where(eq(user.id, current.user.id));
    return c.body(null, 204);
  });

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
