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
import { moderationRoutes } from "./moderation.ts";
import { scalewayMailer } from "./scaleway-mailer.ts";
import { database, user } from "./schema.ts";
import { submissionRoutes } from "./submissions.ts";

export type Mailer = (env: AuthEnv) => SendMail;

const scaleway: Mailer = (env) =>
  scalewayMailer({
    secretKey: env.SCW_SECRET_KEY,
    projectId: env.SCW_PROJECT_ID,
    from: env.MAIL_FROM,
  });

const ALWAYS_OPEN = new Set(["/api/auth/get-session", "/api/auth/sign-out"]);
/** Reachable before the age step is answered (ADR 0015). */
const BEFORE_AGE_STEP = new Set(["/api/account/age", "/api/auth/delete-user"]);
/** Reachable before the second factor of an account that turned it on is verified. */
const BEFORE_SECOND_FACTOR = new Set([
  "/api/auth/two-factor/verify-totp",
  "/api/auth/two-factor/verify-backup-code",
]);
const isAdminPath = (path: string) =>
  path.startsWith("/api/admin/") || path.startsWith("/api/auth/admin/");

const refused = (code: ApiError["code"], message: string): ApiError => ({ code, message });

export const createApp = (jobs: readonly string[], mailer: Mailer = scaleway) => {
  const app = new Hono<{ Bindings: Env }>().basePath("/api");

  // Pages applies apps/web/public/_headers to static files only. HSTS matches it.
  app.use(
    secureHeaders({
      strictTransportSecurity: "max-age=63072000; includeSubDomains",
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    }),
  );

  const settingsOf = (env: Env): AuthEnv => {
    const settings = AuthEnv.safeParse(env);
    if (!settings.success) {
      const names = settings.error.issues.map(({ path }) => path.join(".")).join(", ");
      throw new Error(`Auth settings missing or invalid: ${names}`);
    }
    return settings.data;
  };
  const authOf = (env: Env): Auth => {
    const settings = settingsOf(env);
    return createAuth(database(env.DB), settings, mailer(settings));
  };

  app.use(async (c, next) => {
    const path = c.req.path;
    const admin = isAdminPath(path);
    if (ALWAYS_OPEN.has(path)) return next();
    const current = getSessionCookie(c.req.raw)
      ? await authOf(c.env).api.getSession({ headers: c.req.raw.headers })
      : null;
    if (!current) return admin ? c.json(refused("UNAUTHORIZED", "Sign in first"), 401) : next();
    if (!current.user.ageDeclaredAt && !BEFORE_AGE_STEP.has(path)) {
      return c.json(refused("AGE_DECLARATION_REQUIRED", "Answer the age step first"), 403);
    }
    const secondFactorPending =
      current.user.twoFactorEnabled === true && !current.session.twoFactorVerifiedAt;
    if (secondFactorPending && !BEFORE_SECOND_FACTOR.has(path)) {
      return c.json(refused("TWO_FACTOR_REQUIRED", "Enter your authenticator code first"), 403);
    }
    if (admin && current.user.role !== "admin") {
      return c.json(refused("ADMIN_REQUIRED", "Reserved to the admin"), 403);
    }
    if (admin && current.user.twoFactorEnabled !== true) {
      return c.json(refused("TWO_FACTOR_REQUIRED", "Turn on an authenticator code first"), 403);
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

  app.route("/submissions", submissionRoutes(authOf));
  app.route(
    "/admin",
    moderationRoutes(authOf, (env) => {
      const settings = settingsOf(env);
      return { sendMail: mailer(settings), contact: settings.CONTACT_EMAIL };
    }),
  );

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
