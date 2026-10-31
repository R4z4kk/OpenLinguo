import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backupCodesFile,
  declareAge,
  keyOf,
  loadSession,
  loadSignInMethods,
  safeReturn,
  sendCode,
  signInWithCode,
  startSocial,
  stepOf,
} from "./account.ts";

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(status === 204 ? null : JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json", ...headers },
        }),
      ),
    ),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

const session = {
  session: { twoFactorVerifiedAt: null },
  user: {
    email: "lin@example.test",
    name: "",
    role: null,
    twoFactorEnabled: false,
    ageDeclaredAt: new Date("2026-10-31T10:00:00.000Z"),
  },
};

describe("stepOf", () => {
  it("asks for the age, then the second factor, before the account is ready", () => {
    expect(stepOf(null)).toBe("signed-out");
    expect(stepOf({ ...session, user: { ...session.user, ageDeclaredAt: null } })).toBe("age");
    const withTotp = { ...session, user: { ...session.user, twoFactorEnabled: true } };
    expect(stepOf(withTotp)).toBe("second-factor");
    expect(stepOf({ ...withTotp, session: { twoFactorVerifiedAt: new Date() } })).toBe("ready");
    expect(stepOf(session)).toBe("ready");
  });
});

describe("safeReturn", () => {
  it("keeps paths of this app only", () => {
    expect(safeReturn("/read/a/submit")).toBe("/read/a/submit");
    for (const unsafe of ["//evil.test", "/\\evil.test", "https://evil.test", "", 3, null]) {
      expect(safeReturn(unsafe)).toBe("/profile/account");
    }
  });
});

describe("keyOf", () => {
  it("prints the secret in groups of four", () => {
    expect(keyOf("otpauth://totp/OpenLinguo:lin?secret=JBSWY3DPEHPK3PXP&issuer=OpenLinguo")).toBe(
      "JBSW Y3DP EHPK 3PXP",
    );
    expect(keyOf("otpauth://totp/OpenLinguo:lin")).toBeNull();
  });
});

describe("backupCodesFile", () => {
  it("puts one code per line under a heading", () => {
    expect(backupCodesFile(["aaaaa-bbbbb", "ccccc-ddddd"], "Codes")).toBe(
      "Codes\n\naaaaa-bbbbb\nccccc-ddddd\n",
    );
  });
});

describe("the account calls", () => {
  it("read the session with its dates, and a signed-out null", async () => {
    answer(200, {
      ...session,
      user: { ...session.user, ageDeclaredAt: "2026-10-31T10:00:00.000Z" },
    });
    expect(await loadSession()).toEqual({ ok: true, value: session });
    answer(200, null);
    expect(await loadSession()).toEqual({ ok: true, value: null });
  });

  it("ask only for sign-in codes and post the typed one", async () => {
    answer(200, { success: true });
    expect(await sendCode("lin@example.test")).toEqual({ ok: true, value: null });
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/email-otp/send-verification-otp",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "lin@example.test", type: "sign-in" }),
      }),
    );
    answer(200, { token: "t", user: {} });
    expect(await signInWithCode("lin@example.test", "123456")).toEqual({ ok: true, value: null });
  });

  it("turn the API's and Better Auth's refusals into their codes", async () => {
    answer(403, { code: "SIGNUPS_CLOSED", message: "Sign-ups are closed" });
    expect(await sendCode("new@example.test")).toEqual({
      ok: false,
      error: { kind: "refused", code: "SIGNUPS_CLOSED" },
    });
    answer(400, { code: "INVALID_OTP", message: "Invalid OTP" });
    expect(await signInWithCode("lin@example.test", "000000")).toEqual({
      ok: false,
      error: { kind: "refused", code: "INVALID_OTP" },
    });
  });

  it("read Better Auth's rate limit, which has no code, from X-Retry-After", async () => {
    answer(
      429,
      { message: "Too many requests. Please try again later." },
      { "X-Retry-After": "540" },
    );
    expect(await sendCode("lin@example.test")).toEqual({
      ok: false,
      error: { kind: "rate-limited", retryAfterSeconds: 540 },
    });
    answer(429, { message: "Too many requests." });
    expect(await sendCode("lin@example.test")).toEqual({
      ok: false,
      error: { kind: "rate-limited", retryAfterSeconds: null },
    });
    answer(429, { code: "TOO_MANY_ATTEMPTS", message: "Too many wrong codes" });
    expect(await sendCode("lin@example.test")).toEqual({
      ok: false,
      error: { kind: "refused", code: "TOO_MANY_ATTEMPTS" },
    });
  });

  it("send the provider back to the sign-in page with the return address", async () => {
    answer(200, { url: "https://github.com/login/oauth/authorize?state=s", redirect: true });
    expect(await startSocial("github", "/read/a/submit")).toEqual({
      ok: true,
      value: "https://github.com/login/oauth/authorize?state=s",
    });
    const back = "/account/sign-in?return=%2Fread%2Fa%2Fsubmit";
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/sign-in/social",
      expect.objectContaining({
        body: JSON.stringify({ provider: "github", callbackURL: back, errorCallbackURL: back }),
      }),
    );
  });

  it("accept both answers of the age step", async () => {
    answer(204, null);
    expect(await declareAge("15-or-over")).toEqual({ ok: true, value: null });
    answer(200, { success: true });
    expect(await declareAge("under-15")).toEqual({ ok: true, value: null });
  });

  it("name the sign-in methods, an email code for anything but Google and GitHub", async () => {
    answer(200, [{ providerId: "github" }, { providerId: "credential" }]);
    expect(await loadSignInMethods()).toEqual({ ok: true, value: ["github", "email"] });
  });
});
