import { EMAIL_CODE, PseudonymUpdate, SECOND_FACTOR_LOCK } from "@openlinguo/core/account";
import type { ApiError } from "@openlinguo/core/api-error";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { admin, emailOTP, twoFactor as secondFactor } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";
import { and, count, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { SendMail } from "./mail.ts";
import { localeOf, signInCodeMail } from "./mail-templates.ts";
import {
  account,
  type Database,
  rateLimit,
  SECURITY_EVENT_TYPES,
  securityEvent,
  session,
  twoFactor,
  user,
  verification,
} from "./schema.ts";

/** Secrets and settings the maintainer enters in the Pages project (apps/api/README.md). */
export const AuthEnv = z.object({
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url().refine((url) => {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" || (protocol === "http:" && hostname === "localhost");
  }),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  SCW_SECRET_KEY: z.string().min(1),
  SCW_PROJECT_ID: z.uuid(),
  MAIL_FROM: z.email(),
  /** Where submitters ask for a review of a decision (DSA art. 17(3)(f)). */
  CONTACT_EMAIL: z.email(),
  SIGNUPS_OPEN: z.enum(["true", "false"]).default("false"),
});
export type AuthEnv = z.output<typeof AuthEnv>;

const CODE_PATH = "/email-otp/send-verification-otp";
const OTP_SIGN_IN_PATH = "/sign-in/email-otp";
const CALLBACK_PATH = "/callback/:id";
const UPDATE_USER_PATH = "/update-user";
const SECOND_FACTOR_METHODS = new Map([
  ["/two-factor/verify-totp", "totp"],
  ["/two-factor/verify-backup-code", "backup-code"],
]);

const access = createAccessControl(defaultStatements);
/** No role changes, creation, impersonation or deletion: the role is granted outside the app. */
const roles = {
  admin: access.newRole({ user: ["list", "get", "ban"], session: ["list", "revoke"] }),
  user: access.newRole({ user: [], session: [] }),
};

const refusal = (
  status: "FORBIDDEN" | "BAD_GATEWAY" | "BAD_REQUEST" | "TOO_MANY_REQUESTS",
  body: ApiError,
) => new APIError(status, body);

/** OpenLinguo never calls Google or GitHub after sign-in, so their tokens are not kept. */
const withoutTokens = <T extends object>(data: T) =>
  Promise.resolve({ data: { ...data, accessToken: null, refreshToken: null, idToken: null } });

type Event = {
  readonly type: (typeof SECURITY_EVENT_TYPES)[number];
  readonly path: string;
  readonly provider: string | null;
  readonly headers: Headers | null;
  readonly userId: string | null;
  readonly reason: string | null;
  readonly target: string | null;
};

const methodOf = (path: string, provider: string | null) => {
  if (path === CALLBACK_PATH) return provider ?? "oauth";
  if (path.startsWith("/admin/")) return path.slice(1);
  return SECOND_FACTOR_METHODS.get(path) ?? "email-otp";
};

const targetOf = (body: unknown, query: unknown) =>
  z.object({ userId: z.string() }).safeParse(body).data?.userId ??
  z.object({ id: z.string() }).safeParse(query).data?.id ??
  null;

export const createAuth = (db: Database, env: AuthEnv, sendMail: SendMail) => {
  const signupsOpen = env.SIGNUPS_OPEN === "true";
  // Better Auth swallows errors thrown by sendVerificationOTP: the after hook answers them.
  let mailFailed = false;

  const record = async ({ type, path, provider, headers, userId, reason, target }: Event) => {
    await db.insert(securityEvent).values({
      type,
      method: methodOf(path, provider),
      userId,
      ipAddress: headers?.get("cf-connecting-ip") ?? null,
      userAgent: headers?.get("user-agent") ?? null,
      reason,
      target,
    });
  };

  const secondFactorLocked = async (userId: string) => {
    const since = new Date(Date.now() - SECOND_FACTOR_LOCK.minutes * 60 * 1000);
    const [failures] = await db
      .select({ total: count() })
      .from(securityEvent)
      .where(
        and(
          eq(securityEvent.type, "second_factor_failed"),
          eq(securityEvent.userId, userId),
          gt(securityEvent.createdAt, since),
        ),
      );
    return (failures?.total ?? 0) >= SECOND_FACTOR_LOCK.failures;
  };

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    telemetry: { enabled: false },
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user, session, account, verification, rateLimit, twoFactor },
    }),
    advanced: {
      useSecureCookies: true,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        [CODE_PATH]: { window: 600, max: 3 },
        [OTP_SIGN_IN_PATH]: { window: 600, max: 5 },
        "/sign-in/social": { window: 60, max: 10 },
        ...Object.fromEntries(
          [...SECOND_FACTOR_METHODS.keys()].map((path) => [path, { window: 600, max: 5 }]),
        ),
      },
    },
    user: {
      additionalFields: { ageDeclaredAt: { type: "date", required: false, input: false } },
      deleteUser: { enabled: true },
    },
    session: {
      additionalFields: { twoFactorVerifiedAt: { type: "date", required: false, input: false } },
    },
    socialProviders: {
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
      github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
    },
    plugins: [
      emailOTP({
        otpLength: EMAIL_CODE.length,
        expiresIn: EMAIL_CODE.minutes * 60,
        allowedAttempts: EMAIL_CODE.attempts,
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp }, ctx) {
          const locale = localeOf(ctx?.headers?.get("accept-language") ?? null);
          const sent = await sendMail(signInCodeMail(locale, email, otp));
          if (!sent.ok) {
            console.error("sign-in code not sent", sent.error);
            mailFailed = true;
          }
        },
      }),
      secondFactor({ issuer: "OpenLinguo", allowPasswordless: true }),
      admin({ ac: access, roles }),
    ],
    databaseHooks: {
      user: {
        create: {
          before: (newUser) => {
            if (!signupsOpen) {
              throw refusal("FORBIDDEN", {
                code: "SIGNUPS_CLOSED",
                message: "Sign-ups are closed",
              });
            }
            return Promise.resolve({ data: { ...newUser, name: "", image: null } });
          },
        },
      },
      account: {
        create: { before: withoutTokens },
        update: { before: withoutTokens },
      },
      session: {
        create: {
          after: async (created, ctx) => {
            if (!ctx || (ctx.path !== OTP_SIGN_IN_PATH && ctx.path !== CALLBACK_PATH)) return;
            await record({
              type: "sign_in",
              path: ctx.path,
              provider: ctx.params?.["id"] ?? null,
              headers: ctx.headers ?? null,
              userId: created.userId,
              reason: null,
              target: null,
            });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (SECOND_FACTOR_METHODS.has(ctx.path)) {
          const current = await getSessionFromCtx(ctx);
          if (current && (await secondFactorLocked(current.user.id))) {
            throw refusal("TOO_MANY_REQUESTS", {
              code: "TOO_MANY_ATTEMPTS",
              message: `Too many wrong codes, try again in ${String(SECOND_FACTOR_LOCK.minutes)} minutes`,
            });
          }
          return;
        }
        if (ctx.path === UPDATE_USER_PATH) {
          if (!PseudonymUpdate.safeParse(ctx.body).success) {
            throw refusal("BAD_REQUEST", {
              code: "INVALID_REQUEST",
              message: "Only the pseudonym can change, as plain text",
            });
          }
          return;
        }
        if (ctx.path !== CODE_PATH) return;
        const body = z.object({ email: z.string(), type: z.string() }).safeParse(ctx.body);
        if (!body.success || body.data.type !== "sign-in") {
          throw refusal("BAD_REQUEST", {
            code: "INVALID_REQUEST",
            message: "Only sign-in codes are sent",
          });
        }
        const known = await ctx.context.internalAdapter.findUserByEmail(
          body.data.email.toLowerCase(),
        );
        if (!known && !signupsOpen) {
          throw refusal("FORBIDDEN", { code: "SIGNUPS_CLOSED", message: "Sign-ups are closed" });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned;
        const log = (
          type: Event["type"],
          userId: string | null,
          reason: string | null,
          target: string | null = null,
        ) =>
          record({
            type,
            path: ctx.path,
            provider: ctx.params?.["id"] ?? null,
            headers: ctx.headers ?? null,
            userId,
            reason,
            target,
          });
        if (SECOND_FACTOR_METHODS.has(ctx.path)) {
          const verified = ctx.context.newSession ?? (await getSessionFromCtx(ctx));
          const userId = verified?.user.id ?? null;
          if (isAPIError(returned)) {
            await log(
              "second_factor_failed",
              userId,
              String(returned.body?.code ?? returned.status),
            );
            return;
          }
          if (verified) {
            await db
              .update(session)
              .set({ twoFactorVerifiedAt: new Date() })
              .where(eq(session.token, verified.session.token));
          }
          await log("second_factor", userId, null);
          return;
        }
        if (ctx.path.startsWith("/admin/") && !isAPIError(returned)) {
          const author = await getSessionFromCtx(ctx);
          await log("admin_action", author?.user.id ?? null, null, targetOf(ctx.body, ctx.query));
          return;
        }
        if (ctx.path === CODE_PATH && mailFailed) {
          throw refusal("BAD_GATEWAY", {
            code: "MAIL_FAILED",
            message: "The sign-in code could not be sent",
          });
        }
        if (ctx.path === CODE_PATH && !isAPIError(returned)) {
          const email = z.object({ email: z.string() }).parse(ctx.body).email.toLowerCase();
          const known = await ctx.context.internalAdapter.findUserByEmail(email);
          await log("code_sent", known?.user.id ?? null, null);
        }
        if (ctx.path === OTP_SIGN_IN_PATH && isAPIError(returned)) {
          await log("sign_in_failed", null, String(returned.body?.code ?? returned.status));
        }
        if (ctx.path === CALLBACK_PATH && isAPIError(returned)) {
          const location = new Headers(returned.headers).get("location") ?? "";
          const error = new URL(location, env.BETTER_AUTH_URL).searchParams.get("error");
          if (error) await log("sign_in_failed", null, error);
        }
      }),
    },
  });
};

export type Auth = ReturnType<typeof createAuth>;
