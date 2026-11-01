import { z } from "zod";
import { StatementOfReasons } from "./moderation.ts";
import { Pseudonym, Submissions } from "./submission.ts";

/** The age step after the first sign-in (ADR 0015): « moins de 15 ans » deletes the account. */
export const AgeDeclaration = z.object({ answer: z.enum(["15-or-over", "under-15"]) });
export type AgeDeclaration = z.output<typeof AgeDeclaration>;

/** The emailed sign-in code (ADR 0015): 6 digits, valid 10 minutes, 3 attempts. */
export const EMAIL_CODE = { length: 6, minutes: 10, attempts: 3 } as const;
/** Wrong authenticator or backup codes that lock the second factor, and for how long. */
export const SECOND_FACTOR_LOCK = { failures: 10, minutes: 15 } as const;

/** `POST /api/auth/update-user`: only the pseudonym may change (rectification). */
export const PseudonymUpdate = z.strictObject({ name: Pseudonym });
export type PseudonymUpdate = z.output<typeof PseudonymUpdate>;

/** The parts of Better Auth's `get-session` answer the app reads; `null` when signed out. */
export const SessionAnswer = z
  .object({
    user: z.object({
      email: z.string(),
      name: z.string(),
      role: z.string().nullish(),
      twoFactorEnabled: z.boolean().nullish(),
      ageDeclaredAt: z.coerce.date().nullish(),
    }),
    session: z.object({ twoFactorVerifiedAt: z.coerce.date().nullish() }),
  })
  .nullable();
export type SessionAnswer = z.output<typeof SessionAnswer>;

/** `GET /api/auth/list-accounts`: how the account signs in. */
export const LinkedAccounts = z.array(z.object({ providerId: z.string() }));
export type LinkedAccounts = z.output<typeof LinkedAccounts>;

/** `POST /api/auth/sign-in/social`: the provider's page to open. */
export const SocialRedirect = z.object({ url: z.url() });

/** `POST /api/auth/two-factor/enable`: the authenticator's URI and the backup codes, shown once. */
export const TotpSetup = z.object({
  totpURI: z.string().startsWith("otpauth://totp/"),
  backupCodes: z.array(z.string().min(1)).min(1),
});
export type TotpSetup = z.output<typeof TotpSetup>;

/** The Better Auth error codes the sign-in screens answer in words. */
export const AuthErrorCode = z.enum([
  "INVALID_OTP",
  "OTP_EXPIRED",
  "TOO_MANY_ATTEMPTS",
  "INVALID_CODE",
  "INVALID_BACKUP_CODE",
]);
export type AuthErrorCode = z.output<typeof AuthErrorCode>;

/** What happens to the published texts when the account is deleted (ADR 0015). */
export const PUBLISHED_CHOICES = ["keep-named", "keep-anonymous", "remove"] as const;
export const PublishedChoice = z.enum(PUBLISHED_CHOICES);
export type PublishedChoice = z.output<typeof PublishedChoice>;

/** `POST /api/account/delete`. */
export const AccountDeletion = z.object({ published: PublishedChoice });
export type AccountDeletion = z.output<typeof AccountDeletion>;

const instant = z.iso.datetime();

/** `GET /api/account/export` (GDPR art. 15 and 20): no token, no secret. */
export const AccountExport = z.object({
  exportedAt: instant,
  account: z.object({
    id: z.string().min(1),
    email: z.string().min(1),
    pseudonym: z.string().nullable(),
    createdAt: instant,
    ageDeclaredAt: instant.nullable(),
    role: z.string().nullable(),
    twoFactorEnabled: z.boolean(),
    /** The latest use the server knows of, for the deletion after 2 years unused. */
    activeAt: instant.nullable(),
    inactivityNoticeAt: instant.nullable(),
  }),
  signInMethods: z.array(z.object({ providerId: z.string().min(1), createdAt: instant })),
  sessions: z.array(
    z.object({
      createdAt: instant,
      expiresAt: instant,
      ipAddress: z.string().nullable(),
      userAgent: z.string().nullable(),
    }),
  ),
  submissions: Submissions,
  decisions: z.array(StatementOfReasons),
  securityEvents: z.array(
    z.object({
      type: z.string().min(1),
      method: z.string().min(1),
      ipAddress: z.string().nullable(),
      userAgent: z.string().nullable(),
      createdAt: instant,
    }),
  ),
});
export type AccountExport = z.output<typeof AccountExport>;
