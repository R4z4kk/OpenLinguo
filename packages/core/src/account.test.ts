import { describe, expect, it } from "vitest";
import {
  AccountDeletion,
  AccountExport,
  AgeDeclaration,
  PseudonymUpdate,
  SessionAnswer,
  TotpSetup,
} from "./account.ts";
import { parseWith } from "./validation.ts";

describe("AgeDeclaration", () => {
  it("accepts both answers", () => {
    for (const answer of ["15-or-over", "under-15"]) {
      expect(parseWith(AgeDeclaration, { answer })).toEqual({ ok: true, value: { answer } });
    }
  });

  it("refuses any other answer", () => {
    expect(parseWith(AgeDeclaration, { answer: "18" }).ok).toBe(false);
    expect(parseWith(AgeDeclaration, {}).ok).toBe(false);
  });
});

describe("SessionAnswer", () => {
  it("reads Better Auth's JSON dates and a signed-out null", () => {
    const answer = parseWith(SessionAnswer, {
      session: { token: "t", twoFactorVerifiedAt: null },
      user: {
        email: "lin@example.test",
        name: "",
        role: null,
        twoFactorEnabled: false,
        ageDeclaredAt: "2026-10-31T10:00:00.000Z",
      },
    });
    expect(answer.ok && answer.value?.user.ageDeclaredAt).toEqual(
      new Date("2026-10-31T10:00:00.000Z"),
    );
    expect(parseWith(SessionAnswer, null)).toEqual({ ok: true, value: null });
    expect(parseWith(SessionAnswer, { user: {} }).ok).toBe(false);
  });
});

describe("PseudonymUpdate", () => {
  it("takes the pseudonym alone", () => {
    expect(parseWith(PseudonymUpdate, { name: " Lin " })).toEqual({
      ok: true,
      value: { name: "Lin" },
    });
    expect(parseWith(PseudonymUpdate, { name: "Lin", image: "x" }).ok).toBe(false);
    expect(parseWith(PseudonymUpdate, { name: "a\tb\u0007" }).ok).toBe(false);
  });
});

describe("TotpSetup", () => {
  it("needs an otpauth TOTP URI and backup codes", () => {
    const totpURI = "otpauth://totp/OpenLinguo:lin?secret=JBSWY3DP&issuer=OpenLinguo";
    expect(parseWith(TotpSetup, { totpURI, backupCodes: ["abcde-fghij"] }).ok).toBe(true);
    expect(parseWith(TotpSetup, { totpURI: "https://x.test", backupCodes: ["a"] }).ok).toBe(false);
    expect(parseWith(TotpSetup, { totpURI, backupCodes: [] }).ok).toBe(false);
  });
});

describe("AccountDeletion", () => {
  it("takes one of the three choices for published texts", () => {
    for (const published of ["keep-named", "keep-anonymous", "remove"]) {
      expect(parseWith(AccountDeletion, { published }).ok).toBe(true);
    }
    expect(parseWith(AccountDeletion, { published: "keep" }).ok).toBe(false);
    expect(parseWith(AccountDeletion, {}).ok).toBe(false);
  });
});

describe("AccountExport", () => {
  it("describes the account without tokens", () => {
    const at = "2026-11-01T10:00:00.000Z";
    const exported = {
      exportedAt: at,
      account: {
        id: "u1",
        email: "lin@example.test",
        pseudonym: null,
        createdAt: at,
        ageDeclaredAt: at,
        role: null,
        twoFactorEnabled: false,
      },
      signInMethods: [{ providerId: "email-otp", createdAt: at }],
      sessions: [{ createdAt: at, expiresAt: at, ipAddress: "198.51.100.1", userAgent: null }],
      submissions: [],
      decisions: [],
      securityEvents: [
        { type: "sign_in", method: "email-otp", ipAddress: null, userAgent: null, createdAt: at },
      ],
    };
    expect(parseWith(AccountExport, exported)).toEqual({ ok: true, value: exported });
    expect(parseWith(AccountExport, { ...exported, sessions: [{ token: "t" }] }).ok).toBe(false);
  });
});
