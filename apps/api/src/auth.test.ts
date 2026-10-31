import { createHmac } from "node:crypto";
import { err } from "@openlinguo/core/result";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { AuthEnv } from "./auth.ts";
import {
  account,
  database,
  rateLimit,
  securityEvent,
  session,
  twoFactor,
  user,
  verification,
} from "./schema.ts";
import { memoryMailer } from "./testing/memory-mailer.ts";
import { migratedPlatform } from "./testing/platform.ts";

const ORIGIN = "https://openlinguo.example.test";
const platform = await migratedPlatform();
const db = database(platform.env.DB);
const settings = {
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
  BETTER_AUTH_URL: ORIGIN,
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  GITHUB_CLIENT_ID: "github-id",
  GITHUB_CLIENT_SECRET: "github-secret",
  SCW_SECRET_KEY: "scw-key",
  SCW_PROJECT_ID: "11111111-1111-4111-8111-111111111111",
  MAIL_FROM: "no-reply@example.test",
};
afterAll(() => platform.dispose());

let mailer = memoryMailer();
let ip = 0;
const clientIp = () => `203.0.113.${String(ip)}`;
beforeEach(async () => {
  for (const table of [securityEvent, session, account, verification, rateLimit, twoFactor, user]) {
    await db.delete(table);
  }
  mailer = memoryMailer();
  ip += 1;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const appWith = (signupsOpen: boolean, sendMail = mailer.sendMail) => {
  const app = createApp([], () => sendMail);
  const env = { ...platform.env, ...settings, SIGNUPS_OPEN: signupsOpen ? "true" : "false" };
  return (
    path: string,
    body: object | null = null,
    cookie: string | null = null,
    headers: Record<string, string> = {},
  ) =>
    app.request(
      `${ORIGIN}${path}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "cf-connecting-ip": clientIp(),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      env,
    );
};

const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");

const lastCode = () => {
  const code = /\b(\d{6})\b/.exec(mailer.sent.at(-1)?.text ?? "")?.[1];
  if (!code) throw new Error("no code mailed");
  return code;
};

const events = async () =>
  (await db.select().from(securityEvent).orderBy(securityEvent.id)).map(
    ({ type, method, reason, ipAddress }) => ({ type, method, reason, ipAddress }),
  );

const sendCode = (call: ReturnType<typeof appWith>, email: string, type = "sign-in") =>
  call("/api/auth/email-otp/send-verification-otp", { email, type });

const signInWithCode = (call: ReturnType<typeof appWith>, email: string, otp: string) =>
  call("/api/auth/sign-in/email-otp", { email, otp });

const signedIn = async (call: ReturnType<typeof appWith>, email: string) => {
  await sendCode(call, email);
  return cookiesOf(await signInWithCode(call, email, lastCode()));
};

describe("email code", () => {
  it("mails a 6-digit code in the request's language, signs in and records both", async () => {
    const call = appWith(true);
    const sent = await call(
      "/api/auth/email-otp/send-verification-otp",
      { email: "Learner@Example.test", type: "sign-in" },
      null,
      { "accept-language": "fr-FR,fr;q=0.9" },
    );
    expect(sent.status).toBe(200);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("learner@example.test");
    expect(mailer.sent[0]?.subject).toMatch(/^Votre code OpenLinguo\u00a0: \d{6}$/);

    const response = await signInWithCode(call, "learner@example.test", lastCode());
    expect(response.status).toBe(200);
    const cookie = response.headers
      .getSetCookie()
      .find((line) => line.startsWith("__Secure-better-auth.session_token="));
    expect(cookie).toMatch(/; Secure/i);
    expect(cookie).toMatch(/; HttpOnly/i);
    expect(cookie).toMatch(/; SameSite=Lax/i);
    const [created] = await db.select().from(user);
    expect(created).toMatchObject({ email: "learner@example.test", name: "", ageDeclaredAt: null });
    expect(await events()).toEqual([
      { type: "code_sent", method: "email-otp", reason: null, ipAddress: clientIp() },
      { type: "sign_in", method: "email-otp", reason: null, ipAddress: clientIp() },
    ]);
  });

  it("stores the code hashed, never as sent", async () => {
    await sendCode(appWith(true), "hash@example.test");
    const [stored] = await db.select().from(verification);
    expect(stored?.value).toBeTruthy();
    expect(stored?.value).not.toContain(lastCode());
  });

  it("refuses a code after 10 minutes", async () => {
    const call = appWith(true);
    await sendCode(call, "late@example.test");
    const code = lastCode();
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 10 * 60 * 1000 + 1000 });
    const response = await signInWithCode(call, "late@example.test", code);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "OTP_EXPIRED" });
    expect((await events()).at(-1)).toMatchObject({
      type: "sign_in_failed",
      reason: "OTP_EXPIRED",
    });
  });

  it("refuses the right code after 3 wrong ones", async () => {
    const call = appWith(true);
    await sendCode(call, "typo@example.test");
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await signInWithCode(call, "typo@example.test", wrong)).status).toBe(400);
    }
    const response = await signInWithCode(call, "typo@example.test", code);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
  });

  it("sends only sign-in codes", async () => {
    const response = await sendCode(appWith(true), "a@example.test", "forget-password");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
    expect(mailer.sent).toEqual([]);
  });

  it("answers 502 MAIL_FAILED when the mail cannot be sent", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => null);
    const failing = () => Promise.resolve(err({ kind: "unreachable" as const, message: "down" }));
    const response = await sendCode(appWith(true, failing), "a@example.test");
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "MAIL_FAILED" });
    expect(error).toHaveBeenCalledWith("sign-in code not sent", {
      kind: "unreachable",
      message: "down",
    });
    expect(await events()).toEqual([]);
  });

  it("limits code requests to 3 per 10 minutes per IP", async () => {
    const call = appWith(true);
    for (let request = 0; request < 3; request += 1) {
      expect((await sendCode(call, `r${String(request)}@example.test`)).status).toBe(200);
    }
    expect((await sendCode(call, "r3@example.test")).status).toBe(429);
    expect(mailer.sent).toHaveLength(3);
  });
});

describe("sign-ups closed", () => {
  it("refuses a code to a new email with SIGNUPS_CLOSED and mails nothing", async () => {
    const response = await sendCode(appWith(false), "new@example.test");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      code: "SIGNUPS_CLOSED",
      message: "Sign-ups are closed",
    });
    expect(mailer.sent).toEqual([]);
  });

  it("still signs in an existing account", async () => {
    const opened = await signedIn(appWith(true), "known@example.test");
    expect(opened).toContain("session_token");
    const call = appWith(false);
    expect((await sendCode(call, "known@example.test")).status).toBe(200);
    expect((await signInWithCode(call, "known@example.test", lastCode())).status).toBe(200);
  });
});

describe("age step", () => {
  it("answers 403 AGE_DECLARATION_REQUIRED until answered, except the step, session, sign-out and deletion", async () => {
    const call = appWith(true);
    const cookie = await signedIn(call, "teen@example.test");
    const gated = await call("/api/health", null, cookie);
    expect(gated.status).toBe(403);
    expect(await gated.json()).toEqual({
      code: "AGE_DECLARATION_REQUIRED",
      message: "Answer the age step first",
    });
    expect((await call("/api/auth/list-sessions", null, cookie)).status).toBe(403);
    expect((await call("/api/auth/get-session", null, cookie)).status).toBe(200);
    expect((await call("/api/health")).status).toBe(200);

    expect((await call("/api/account/age", { answer: "15-or-over" }, cookie)).status).toBe(204);
    expect((await call("/api/health", null, cookie)).status).toBe(200);
    const [declared] = await db.select().from(user);
    expect(declared?.ageDeclaredAt).toBeInstanceOf(Date);
  });

  it("deletes the account at once for « moins de 15 ans » and clears the cookie", async () => {
    const call = appWith(true);
    const cookie = await signedIn(call, "child@example.test");
    const response = await call("/api/account/age", { answer: "under-15" }, cookie);
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().join()).toMatch(/__Secure-better-auth\.session_token=;/);
    expect(await db.select().from(user)).toEqual([]);
    expect(await db.select().from(session)).toEqual([]);
    expect((await db.select().from(securityEvent)).every(({ userId }) => userId === null)).toBe(
      true,
    );
  });

  it("lets the account be deleted before the answer", async () => {
    const call = appWith(true);
    const cookie = await signedIn(call, "leaving@example.test");
    expect((await call("/api/auth/delete-user", {}, cookie)).status).toBe(200);
    expect(await db.select().from(user)).toEqual([]);
  });

  it("answers 401 without a session and 400 for another answer", async () => {
    const call = appWith(true);
    const anonymous = await call("/api/account/age", { answer: "15-or-over" });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ code: "UNAUTHORIZED" });
    const cookie = await signedIn(call, "vague@example.test");
    const invalid = await call("/api/account/age", { answer: "18" }, cookie);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("pseudonym", () => {
  it("changes only a plain-text pseudonym of at most 40 characters", async () => {
    const call = appWith(true);
    const cookie = await declared(call, "named@example.test");
    for (const body of [
      { name: "x".repeat(41) },
      { name: "two\nlines" },
      { name: " " },
      { name: "Lin", image: "https://photos.example.test/1" },
      {},
    ]) {
      const refused = await call("/api/auth/update-user", body, cookie);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ code: "INVALID_REQUEST" });
    }
    expect((await call("/api/auth/update-user", { name: "Lin" }, cookie)).status).toBe(200);
    const [named] = await db.select().from(user);
    expect(named).toMatchObject({ name: "Lin", image: null });
  });
});

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

const stubProviders = () => {
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://github.com/login/oauth/access_token")) {
      return Promise.resolve(
        Response.json({ access_token: "gh-token", token_type: "bearer", scope: "user:email" }),
      );
    }
    if (url === "https://api.github.com/user") {
      return Promise.resolve(
        Response.json({
          id: 42,
          login: "octo",
          name: "Real Name",
          email: "octo@example.test",
          avatar_url: "https://avatars.example.test/42",
        }),
      );
    }
    if (url === "https://api.github.com/user/emails") {
      return Promise.resolve(
        Response.json([{ email: "octo@example.test", primary: true, verified: true }]),
      );
    }
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const claims = {
        iss: "https://accounts.google.com",
        aud: "google-id",
        sub: "g-7",
        email: "gina@example.test",
        email_verified: true,
        name: "Gina Real",
        picture: "https://photos.example.test/7",
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      return Promise.resolve(
        Response.json({
          access_token: "g-token",
          expires_in: 3600,
          token_type: "Bearer",
          id_token: `${base64url({ alg: "RS256" })}.${base64url(claims)}.signature`,
        }),
      );
    }
    return real(input, init);
  });
};

const oauth = async (call: ReturnType<typeof appWith>, provider: "github" | "google") => {
  const started = await call("/api/auth/sign-in/social", { provider, callbackURL: "/" });
  expect(started.status).toBe(200);
  const { url } = await started.json<{ url: string }>();
  const state = new URL(url).searchParams.get("state") ?? "";
  return call(
    `/api/auth/callback/${provider}?code=provider-code&state=${state}`,
    null,
    cookiesOf(started),
  );
};

describe("OAuth", () => {
  for (const provider of ["github", "google"] as const) {
    it(`signs in with ${provider}, keeping neither the name, the picture nor the tokens`, async () => {
      stubProviders();
      const response = await oauth(appWith(true), provider);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/");
      expect(cookiesOf(response)).toContain("__Secure-better-auth.session_token=");
      const [created] = await db.select().from(user);
      expect(created).toMatchObject({ name: "", image: null, ageDeclaredAt: null });
      const [linked] = await db.select().from(account).where(eq(account.providerId, provider));
      expect(linked).toMatchObject({ accessToken: null, refreshToken: null, idToken: null });
      expect(await events()).toEqual([
        { type: "sign_in", method: provider, reason: null, ipAddress: clientIp() },
      ]);
    });
  }

  it("refuses a new GitHub account while sign-ups are closed and records the failure", async () => {
    stubProviders();
    const response = await oauth(appWith(false), "github");
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location") ?? "", ORIGIN).searchParams.get("error")).toBe(
      "SIGNUPS_CLOSED",
    );
    expect(await db.select().from(user)).toEqual([]);
    expect(await events()).toEqual([
      {
        type: "sign_in_failed",
        method: "github",
        reason: "SIGNUPS_CLOSED",
        ipAddress: clientIp(),
      },
    ]);
  });
});

describe("protections", () => {
  it("refuses a cookie-carrying POST from another origin", async () => {
    const call = appWith(true);
    const cookie = await signedIn(call, "csrf@example.test");
    const response = await call("/api/auth/sign-out", {}, cookie, {
      origin: "https://evil.example.test",
    });
    expect(response.status).toBe(403);
    expect(await db.select().from(session)).toHaveLength(1);
  });

  it("answers 500 INTERNAL, naming only the missing settings in the log", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => null);
    const response = await createApp([]).request(
      `${ORIGIN}/api/auth/get-session`,
      {},
      platform.env,
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "INTERNAL", message: "Internal error" });
    expect(String(error.mock.calls[0]?.[0])).toContain("BETTER_AUTH_SECRET");
  });
});

describe("AuthEnv", () => {
  it("keeps sign-ups closed unless SIGNUPS_OPEN is exactly true", () => {
    expect(AuthEnv.parse(settings).SIGNUPS_OPEN).toBe("false");
    expect(AuthEnv.safeParse({ ...settings, SIGNUPS_OPEN: "yes" }).success).toBe(false);
  });

  it("takes an https origin, or http on localhost for wrangler pages dev", () => {
    const valid = (url: string) => AuthEnv.safeParse({ ...settings, BETTER_AUTH_URL: url }).success;
    expect(valid("https://openlinguo.razakk.fr")).toBe(true);
    expect(valid("http://localhost:8788")).toBe(true);
    expect(valid("http://openlinguo.razakk.fr")).toBe(false);
  });
});

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 6238 with SHA-1, 6 digits and 30 seconds, from the secret of an otpauth URI. */
const totp = (uri: string, at = Date.now()) => {
  const secret = new URL(uri).searchParams.get("secret") ?? "";
  const bits = secret
    .toUpperCase()
    .replace(/./g, (char) => BASE32.indexOf(char).toString(2).padStart(5, "0"));
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
};

const otherCode = (code: string) => String((Number(code) + 500_000) % 1_000_000).padStart(6, "0");

const declared = async (call: ReturnType<typeof appWith>, email: string) => {
  const cookie = await signedIn(call, email);
  expect((await call("/api/account/age", { answer: "15-or-over" }, cookie)).status).toBe(204);
  return cookie;
};

const grantAdmin = (email: string) =>
  db.update(user).set({ role: "admin" }).where(eq(user.email, email));

const withTotp = async (call: ReturnType<typeof appWith>, cookie: string) => {
  const enabled = await call("/api/auth/two-factor/enable", {}, cookie);
  expect(enabled.status).toBe(200);
  const { totpURI, backupCodes } = await enabled.json<{
    totpURI: string;
    backupCodes: string[];
  }>();
  expect(new URL(totpURI).pathname).toContain("OpenLinguo");
  const verified = await call("/api/auth/two-factor/verify-totp", { code: totp(totpURI) }, cookie);
  expect(verified.status).toBe(200);
  return { cookie: cookiesOf(verified), totpURI, backupCodes };
};

const verifyTotp = (
  call: ReturnType<typeof appWith>,
  code: string,
  cookie: string,
  headers: Record<string, string> = {},
) => call("/api/auth/two-factor/verify-totp", { code }, cookie, headers);

describe("second factor and admin", () => {
  it("refuses admin routes without a session, and to an admin without a second factor", async () => {
    const call = appWith(true);
    const anonymous = await call("/api/admin/queue");
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ code: "UNAUTHORIZED" });

    const cookie = await declared(call, "admin@example.test");
    await grantAdmin("admin@example.test");
    for (const path of ["/api/auth/admin/list-users", "/api/admin/queue"]) {
      const refused = await call(path, null, cookie);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ code: "TWO_FACTOR_REQUIRED" });
    }
  });

  it("accepts an admin after a TOTP code computed here, and records each action", async () => {
    const call = appWith(true);
    const first = await declared(call, "admin@example.test");
    await grantAdmin("admin@example.test");
    const { cookie } = await withTotp(call, first);
    const [admin] = await db.select().from(user);
    const adminId = admin?.id ?? "";

    expect((await call("/api/auth/admin/list-users", null, cookie)).status).toBe(200);
    expect((await call(`/api/auth/admin/get-user?id=${adminId}`, null, cookie)).status).toBe(200);
    expect((await call("/api/admin/queue", null, cookie)).status).toBe(404);

    const logged = await db.select().from(securityEvent).orderBy(securityEvent.id);
    expect(
      logged
        .filter(({ type }) => type !== "code_sent" && type !== "sign_in")
        .map(({ type, method, userId, target }) => ({ type, method, userId, target })),
    ).toEqual([
      { type: "second_factor", method: "totp", userId: adminId, target: null },
      { type: "admin_action", method: "admin/list-users", userId: adminId, target: null },
      { type: "admin_action", method: "admin/get-user", userId: adminId, target: adminId },
    ]);
  });

  it("asks every new session of an account with TOTP for the code first", async () => {
    const call = appWith(true);
    const { totpURI } = await withTotp(call, await declared(call, "careful@example.test"));
    const cookie = await signedIn(call, "careful@example.test");

    const gated = await call("/api/health", null, cookie);
    expect(gated.status).toBe(403);
    expect(await gated.json()).toEqual({
      code: "TWO_FACTOR_REQUIRED",
      message: "Enter your authenticator code first",
    });
    expect((await call("/api/auth/two-factor/disable", {}, cookie)).status).toBe(403);
    expect((await call("/api/auth/delete-user", {}, cookie)).status).toBe(403);
    expect((await call("/api/account/age", { answer: "under-15" }, cookie)).status).toBe(403);
    expect((await call("/api/auth/get-session", null, cookie)).status).toBe(200);

    expect((await verifyTotp(call, otherCode(totp(totpURI)), cookie)).status).toBe(401);
    expect((await verifyTotp(call, totp(totpURI), cookie)).status).toBe(200);
    expect((await call("/api/health", null, cookie)).status).toBe(200);
    expect((await events()).filter(({ type }) => type.startsWith("second_factor"))).toEqual([
      { type: "second_factor", method: "totp", reason: null, ipAddress: clientIp() },
      {
        type: "second_factor_failed",
        method: "totp",
        reason: "INVALID_CODE",
        ipAddress: clientIp(),
      },
      { type: "second_factor", method: "totp", reason: null, ipAddress: clientIp() },
    ]);
  });

  it("accepts a backup code once", async () => {
    const call = appWith(true);
    const { backupCodes } = await withTotp(call, await declared(call, "lost@example.test"));
    const code = backupCodes[0] ?? "";
    const cookie = await signedIn(call, "lost@example.test");
    const used = await call("/api/auth/two-factor/verify-backup-code", { code }, cookie);
    expect(used.status).toBe(200);
    expect((await call("/api/health", null, cookie)).status).toBe(200);

    const again = await signedIn(call, "lost@example.test");
    const reused = await call("/api/auth/two-factor/verify-backup-code", { code }, again);
    expect(reused.status).toBe(401);
  });

  it("locks the second factor after 10 wrong codes in 15 minutes, from any IP", async () => {
    const call = appWith(true);
    const { totpURI } = await withTotp(call, await declared(call, "target@example.test"));
    const cookie = await signedIn(call, "target@example.test");
    const wrong = otherCode(totp(totpURI));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const from = { "cf-connecting-ip": `198.51.100.${String(attempt)}` };
      expect((await verifyTotp(call, wrong, cookie, from)).status).toBe(401);
    }
    const from = { "cf-connecting-ip": "198.51.100.200" };
    const locked = await verifyTotp(call, totp(totpURI), cookie, from);
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
  });

  it("limits code checks to 5 per 10 minutes per IP", async () => {
    const call = appWith(true);
    const { totpURI } = await withTotp(call, await declared(call, "slow@example.test"));
    const cookie = await signedIn(call, "slow@example.test");
    const wrong = otherCode(totp(totpURI));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await verifyTotp(call, wrong, cookie)).status).toBe(401);
    }
    expect((await verifyTotp(call, wrong, cookie)).status).toBe(429);
  });

  it("refuses admin routes to other accounts, even with TOTP", async () => {
    const call = appWith(true);
    const { cookie } = await withTotp(call, await declared(call, "learner@example.test"));
    const refused = await call("/api/auth/admin/list-users", null, cookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "ADMIN_REQUIRED" });
  });

  it("never grants a role, creates, impersonates or deletes through the API", async () => {
    const call = appWith(true);
    await declared(call, "learner@example.test");
    const first = await declared(call, "admin@example.test");
    await grantAdmin("admin@example.test");
    const { cookie } = await withTotp(call, first);
    const [learner] = await db.select().from(user).where(eq(user.email, "learner@example.test"));
    const userId = learner?.id ?? "";

    for (const [path, body] of [
      ["/api/auth/admin/set-role", { userId, role: "admin" }],
      ["/api/auth/admin/update-user", { userId, data: { role: "admin" } }],
      ["/api/auth/admin/create-user", { email: "new@example.test", name: "", role: "admin" }],
      ["/api/auth/admin/impersonate-user", { userId }],
      ["/api/auth/admin/remove-user", { userId }],
    ] as const) {
      expect((await call(path, body, cookie)).status).toBe(403);
    }
    const [unchanged] = await db.select().from(user).where(eq(user.id, userId));
    expect(unchanged?.role).not.toBe("admin");
  });
});
