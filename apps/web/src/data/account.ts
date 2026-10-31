import { ok, parseWith, type Result } from "@openlinguo/core";
import {
  type AgeDeclaration,
  LinkedAccounts,
  SessionAnswer,
  SocialRedirect,
  TotpSetup,
} from "@openlinguo/core/account";
import { type ApiFailure, call, post } from "./api.ts";

export type Session = NonNullable<SessionAnswer>;
const PROVIDERS = ["google", "github"] as const;
export type Provider = (typeof PROVIDERS)[number];
export type SignInMethod = Provider | "email";

/** What the account must do before the app can use it (ADR 0015). */
export type AccountStep = "signed-out" | "age" | "second-factor" | "ready";

export const stepOf = (session: SessionAnswer): AccountStep => {
  if (session === null) return "signed-out";
  if (!session.user.ageDeclaredAt) return "age";
  if (session.user.twoFactorEnabled === true && !session.session.twoFactorVerifiedAt)
    return "second-factor";
  return "ready";
};

export const isAdmin = (session: Session): boolean => session.user.role === "admin";

export const TOTP_LENGTH = 6;
/** Better Auth prints backup codes as `xxxxx-xxxxx`, letters and digits. */
export const BACKUP_CODE_LENGTH = 11;

export const DEFAULT_RETURN = "/profile/account";

/** A path of this app only: anything else, `//host` included, returns to the account. */
export const safeReturn = (value: unknown): string =>
  typeof value === "string" && /^\/(?![/\\])/u.test(value) ? value : DEFAULT_RETURN;

const nothing = () => ok(null);

export const loadSession = (): Promise<Result<SessionAnswer, ApiFailure>> =>
  call("/api/auth/get-session", { method: "GET" }, (body) => parseWith(SessionAnswer, body));

export const sendCode = (email: string): Promise<Result<null, ApiFailure>> =>
  call("/api/auth/email-otp/send-verification-otp", post({ email, type: "sign-in" }), nothing);

export const signInWithCode = (email: string, otp: string): Promise<Result<null, ApiFailure>> =>
  call("/api/auth/sign-in/email-otp", post({ email, otp }), nothing);

/** The provider's page; it comes back to `returnTo`, or to the sign-in page with `?error=`. */
export const startSocial = (
  provider: Provider,
  returnTo: string,
): Promise<Result<string, ApiFailure>> => {
  const back = encodeURIComponent(returnTo);
  return call(
    "/api/auth/sign-in/social",
    post({
      provider,
      callbackURL: `/account/sign-in?return=${back}`,
      errorCallbackURL: `/account/sign-in?return=${back}`,
    }),
    (body) => {
      const redirect = parseWith(SocialRedirect, body);
      return redirect.ok ? ok(redirect.value.url) : redirect;
    },
  );
};

/** « Moins de 15 ans » deletes the account and signs out (200); the other answer is 204. */
export const declareAge = (answer: AgeDeclaration["answer"]): Promise<Result<null, ApiFailure>> =>
  call("/api/account/age", post({ answer }), nothing);

export const signOut = (): Promise<Result<null, ApiFailure>> =>
  call("/api/auth/sign-out", post({}), nothing);

/** Every account can get an email code; Google and GitHub only once linked. */
export const loadSignInMethods = (): Promise<Result<readonly SignInMethod[], ApiFailure>> =>
  call("/api/auth/list-accounts", { method: "GET" }, (body) => {
    const linked = parseWith(LinkedAccounts, body);
    if (!linked.ok) return linked;
    const providers = PROVIDERS.filter((provider) =>
      linked.value.some(({ providerId }) => providerId === provider),
    );
    return ok(["email", ...providers]);
  });

export const savePseudonym = (name: string): Promise<Result<null, ApiFailure>> =>
  call("/api/auth/update-user", post({ name }), nothing);

export const enableTotp = (): Promise<Result<TotpSetup, ApiFailure>> =>
  call("/api/auth/two-factor/enable", post({}), (body) => parseWith(TotpSetup, body));

export const verifyTotp = (code: string): Promise<Result<null, ApiFailure>> =>
  call("/api/auth/two-factor/verify-totp", post({ code }), nothing);

export const verifyBackupCode = (code: string): Promise<Result<null, ApiFailure>> =>
  call("/api/auth/two-factor/verify-backup-code", post({ code }), nothing);

/** The authenticator key, in groups of four for reading aloud or typing. */
export const keyOf = (totpURI: string): string | null => {
  const secret = URL.parse(totpURI)?.searchParams.get("secret") ?? null;
  return secret === null ? null : (secret.match(/.{1,4}/gu) ?? []).join(" ");
};

export const backupCodesFile = (codes: readonly string[], heading: string): string =>
  `${heading}\n\n${codes.join("\n")}\n`;
