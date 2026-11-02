import { EMAIL_CODE } from "@openlinguo/core/account";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useAuthFailure } from "@/components/auth-failure";
import { CodeField } from "@/components/code-field";
import { GitHubMark, GoogleMark } from "@/components/provider-marks";
import { Button } from "@/components/ui/button";
import { type Provider, sendCode, signInWithCode, startSocial } from "@/data/account";
import { LegalLinks } from "@/legal/legal-page";
import type { ApiFailure } from "@/data/api";
import { fieldClass } from "@/shell/ai-settings";

type Stage =
  | { readonly kind: "email" }
  | { readonly kind: "code"; readonly email: string; readonly attemptsLeft: number }
  | { readonly kind: "spent"; readonly email: string; readonly expired: boolean }
  | { readonly kind: "closed" };

const Email = z.email();
const SIX_DIGITS = new RegExp(`^\\d{${String(EMAIL_CODE.length)}}$`, "u");

const refusedWith = (failure: ApiFailure, code: string) =>
  failure.kind === "refused" && failure.code === code;

/** Email code first, then Google and GitHub (mockups of #267). `providerError` is OAuth's `?error=`. */
export const SignInPanel = ({
  returnTo,
  providerError,
  onSignedIn,
}: {
  readonly returnTo: string;
  readonly providerError: string | null;
  readonly onSignedIn: () => void;
}) => {
  const { t } = useTranslation("auth");
  const describe = useAuthFailure();
  const id = useId();
  const [stage, setStage] = useState<Stage>(
    providerError === "SIGNUPS_CLOSED" ? { kind: "closed" } : { kind: "email" },
  );
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(
    providerError === null || providerError === "SIGNUPS_CLOSED"
      ? null
      : t("failure.provider", { code: providerError }),
  );
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const emailField = useRef<HTMLInputElement>(null);
  const codeField = useRef<HTMLInputElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [alerted, setAlerted] = useState(problem === null ? 0 : 1);

  useEffect(() => {
    if (alerted > 0) alert.current?.focus();
    else if (stage.kind === "email") emailField.current?.focus();
    else if (stage.kind === "code") codeField.current?.focus();
    else if (stage.kind === "closed") heading.current?.focus();
  }, [stage, alerted]);

  const refuse = (failure: ApiFailure) => {
    if (refusedWith(failure, "SIGNUPS_CLOSED")) {
      setProblem(null);
      setStage({ kind: "closed" });
      return;
    }
    setProblem(describe(failure));
    setAlerted((count) => count + 1);
  };

  const requestCode = async (address: string, again: boolean) => {
    if (busy) return;
    setStatus(t("sending"));
    setBusy(true);
    const result = await sendCode(address);
    setBusy(false);
    setStatus("");
    if (!result.ok) {
      refuse(result.error);
      return;
    }
    setProblem(null);
    setAlerted(0);
    setCode("");
    setFieldError(null);
    setStage({ kind: "code", email: address, attemptsLeft: EMAIL_CODE.attempts });
    if (again) setStatus(t("resent", { email: address }));
  };

  const submitEmail = () => {
    const address = email.trim().toLowerCase();
    if (!Email.safeParse(address).success) {
      setFieldError(t("emailInvalid"));
      emailField.current?.focus();
      return;
    }
    setFieldError(null);
    void requestCode(address, false);
  };

  const confirm = async (current: Extract<Stage, { kind: "code" }>) => {
    if (busy) return;
    const typed = code.replace(/\s/gu, "");
    if (!SIX_DIGITS.test(typed)) {
      setFieldError(t("codeInvalid", { length: EMAIL_CODE.length }));
      codeField.current?.focus();
      return;
    }
    setStatus(t("checking"));
    setBusy(true);
    const result = await signInWithCode(current.email, typed);
    setBusy(false);
    setStatus("");
    if (result.ok) {
      onSignedIn();
      return;
    }
    const { error } = result;
    const left = current.attemptsLeft - 1;
    if (refusedWith(error, "INVALID_OTP") && left > 0) {
      setStage({ ...current, attemptsLeft: left });
      setFieldError(t("codeWrong", { count: left }));
      codeField.current?.focus();
      return;
    }
    if (
      refusedWith(error, "INVALID_OTP") ||
      refusedWith(error, "OTP_EXPIRED") ||
      refusedWith(error, "TOO_MANY_ATTEMPTS")
    ) {
      setProblem(refusedWith(error, "OTP_EXPIRED") ? t("codeExpired") : t("codeSpent"));
      setStage({ kind: "spent", email: current.email, expired: refusedWith(error, "OTP_EXPIRED") });
      setAlerted((count) => count + 1);
      return;
    }
    refuse(error);
  };

  const social = async (provider: Provider) => {
    if (busy) return;
    setBusy(true);
    const result = await startSocial(provider, returnTo);
    if (!result.ok) {
      setBusy(false);
      refuse(result.error);
      return;
    }
    setStatus(t("redirecting"));
    window.location.assign(result.value);
  };

  if (stage.kind === "closed")
    return (
      <>
        <h2 ref={heading} tabIndex={-1} className="mt-6 text-subtitle">
          {t("closedTitle")}
        </h2>
        <p className="mt-2">{t("closedBody")}</p>
        <p className="mt-4">
          <Link to="/profile" className="inline-flex min-h-11 items-center underline">
            {t("profile")}
          </Link>
        </p>
      </>
    );

  return (
    <div className="mt-6 flex max-w-md flex-col gap-4">
      {problem !== null && (
        <div className="flex flex-col items-start gap-2 rounded-card border border-danger p-4">
          <p ref={alert} role="alert" tabIndex={-1} className="text-danger">
            {problem}
          </p>
          {stage.kind === "spent" && (
            <Button variant="outline" onClick={() => void requestCode(stage.email, true)}>
              {t("newCode")}
            </Button>
          )}
        </div>
      )}
      {stage.kind === "email" && (
        <form
          noValidate
          className="flex flex-col items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitEmail();
          }}
        >
          <label htmlFor={`${id}-email`} className="font-semibold">
            {t("email")}
          </label>
          <input
            ref={emailField}
            id={`${id}-email`}
            type="email"
            value={email}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={fieldError !== null}
            {...(fieldError === null ? {} : { "aria-describedby": `${id}-email-error` })}
            onChange={(event) => {
              setEmail(event.currentTarget.value);
              setFieldError(null);
            }}
            className={fieldClass}
          />
          {fieldError !== null && (
            <p id={`${id}-email-error`} className="text-small text-danger">
              {fieldError}
            </p>
          )}
          <Button type="submit" aria-disabled={busy} className="mt-2">
            {t("getCode")}
          </Button>
        </form>
      )}
      {stage.kind === "code" && (
        <form
          noValidate
          className="flex flex-col items-start gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm(stage);
          }}
        >
          <p>{t("codeIntro", { email: stage.email, minutes: EMAIL_CODE.minutes })}</p>
          <CodeField
            numeric
            inputRef={codeField}
            label={t("code")}
            value={code}
            maxLength={EMAIL_CODE.length}
            error={fieldError}
            onChange={(value) => {
              setCode(value);
              setFieldError(null);
            }}
          />
          <Button type="submit" aria-disabled={busy}>
            {t("confirm")}
          </Button>
        </form>
      )}
      {stage.kind !== "email" && (
        <div className="flex flex-col items-start gap-1">
          {stage.kind === "code" && (
            <Button variant="ghost" onClick={() => void requestCode(stage.email, true)}>
              {t("resend")}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              setProblem(null);
              setAlerted(0);
              setFieldError(null);
              setStage({ kind: "email" });
            }}
          >
            {t("otherEmail")}
          </Button>
        </div>
      )}
      <p role="status" className="text-small">
        {status}
      </p>
      {stage.kind === "email" && (
        <>
          <p className="text-muted">{t("or")}</p>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              aria-disabled={busy}
              onClick={() => void social("google")}
              className="inline-flex min-h-11 items-center gap-[10px] rounded-control border border-google-stroke bg-google-fill pr-3 pl-3 font-semibold text-google-ink"
            >
              <GoogleMark className="size-5 flex-none" />
              {t("google")}
            </button>
            <Button
              variant="outline"
              aria-disabled={busy}
              className="justify-start pl-3"
              onClick={() => void social("github")}
            >
              <GitHubMark className="size-5 flex-none" />
              {t("github")}
            </Button>
          </div>
          <p className="text-small text-muted">{t("mailNote")}</p>
          <p className="text-small text-muted">{t("signInLinks", { ns: "legal" })}</p>
          <LegalLinks />
        </>
      )}
    </div>
  );
};
