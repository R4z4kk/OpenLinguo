import type { ApiError } from "@openlinguo/core/api-error";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
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
  SIGNUPS_OPEN: z.enum(["true", "false"]).default("false"),
});
export type AuthEnv = z.output<typeof AuthEnv>;

const CODE_PATH = "/email-otp/send-verification-otp";
const OTP_SIGN_IN_PATH = "/sign-in/email-otp";
const CALLBACK_PATH = "/callback/:id";

const refusal = (status: "FORBIDDEN" | "BAD_GATEWAY" | "BAD_REQUEST", body: ApiError) =>
  new APIError(status, body);

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
};

export const createAuth = (db: Database, env: AuthEnv, sendMail: SendMail) => {
  const signupsOpen = env.SIGNUPS_OPEN === "true";
  // Better Auth swallows errors thrown by sendVerificationOTP: the after hook answers them.
  let mailFailed = false;

  const record = async ({ type, path, provider, headers, userId, reason }: Event) => {
    await db.insert(securityEvent).values({
      type,
      method: path === CALLBACK_PATH ? (provider ?? "oauth") : "email-otp",
      userId,
      ipAddress: headers?.get("cf-connecting-ip") ?? null,
      userAgent: headers?.get("user-agent") ?? null,
      reason,
    });
  };

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],
    telemetry: { enabled: false },
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user, session, account, verification, rateLimit },
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
      },
    },
    user: {
      additionalFields: { ageDeclaredAt: { type: "date", required: false, input: false } },
      deleteUser: { enabled: true },
    },
    socialProviders: {
      google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
      github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 3,
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
            if (!ctx) return;
            await record({
              type: "sign_in",
              path: ctx.path,
              provider: ctx.params?.["id"] ?? null,
              headers: ctx.headers ?? null,
              userId: created.userId,
              reason: null,
            });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
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
        const log = (type: Event["type"], userId: string | null, reason: string | null) =>
          record({
            type,
            path: ctx.path,
            provider: ctx.params?.["id"] ?? null,
            headers: ctx.headers ?? null,
            userId,
            reason,
          });
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
