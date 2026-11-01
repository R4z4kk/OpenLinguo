import { type Attribution, PSEUDONYM_MAX, type Submission } from "@openlinguo/core/submission";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiBadge } from "@/components/ai-badge";
import { NewTabLink } from "@/components/new-tab-link";
import { Button } from "@/components/ui/button";
import { database, type StoredText } from "@/data/database";
import { describeFailure } from "@/data/review-log";
import {
  type Account,
  type ApiFailure,
  loadAccount,
  newSubmission,
  sendSubmission,
} from "@/data/submissions";
import { characterCount, loadText } from "@/data/texts";
import { fieldClass } from "@/shell/ai-settings";

const STATEMENTS = {
  human: ["author", "rights", "irrevocable"],
  ai: ["generated", "noThirdParty"],
} as const;
type Statement = (typeof STATEMENTS)[keyof typeof STATEMENTS][number];

/** One sentence per refusal; the submit page and « Mes textes envoyés » share them. */
export const useApiFailure = () => {
  const { t } = useTranslation();
  return (failure: ApiFailure): string => {
    if (failure.kind === "offline") return t("submit.failure.offline");
    if (failure.kind === "rate-limited") return t("submit.tooMany");
    if (failure.kind === "unexpected")
      return t("submit.failure.unexpected", { status: failure.status });
    switch (failure.code) {
      case "UNAUTHORIZED":
        return t("submit.failure.signedOut");
      case "AGE_DECLARATION_REQUIRED":
        return t("submit.failure.age");
      case "SUBMISSION_LIMIT":
        return t("submit.failure.limit");
      case "SUBMISSION_NOT_PENDING":
        return t("submit.failure.notPending");
      case "INVALID_REQUEST":
        return t("submit.failure.invalid");
      case "NOT_FOUND":
        return t("submit.failure.notFound");
      default:
        return t("submit.failure.unexpected", { status: failure.code });
    }
  };
};

type Loaded =
  | { readonly status: "loading" }
  | { readonly status: "missing" }
  | { readonly status: "copied" }
  | { readonly status: "unreadable"; readonly reason: string }
  | { readonly status: "failed"; readonly failure: ApiFailure }
  | { readonly status: "ready"; readonly text: StoredText; readonly account: Account | null };

const originOf = (text: StoredText) => (text.source === "ai" ? "ai" : "human");

const Form = ({ text, account }: { readonly text: StoredText; readonly account: Account }) => {
  const { t } = useTranslation();
  const describe = useApiFailure();
  const id = useId();
  const origin = originOf(text);
  const [signed, setSigned] = useState(false);
  const [name, setName] = useState(account.pseudonym ?? "");
  const [ticked, setTicked] = useState<ReadonlySet<Statement>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Submission | null>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const sentHeading = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (attempt > 0) alert.current?.focus();
  }, [attempt]);
  useEffect(() => {
    if (sent !== null) sentHeading.current?.focus();
  }, [sent]);

  const refuse = (message: string) => {
    setProblem(message);
    setAttempt((count) => count + 1);
  };

  const send = async () => {
    if (sending) return;
    if (STATEMENTS[origin].some((statement) => !ticked.has(statement))) {
      refuse(t("submit.failure.unticked"));
      return;
    }
    const pseudonym = name.trim();
    if (signed && pseudonym === "") {
      refuse(t("submit.failure.pseudonym"));
      return;
    }
    const attribution: Attribution = signed
      ? { kind: "pseudonym", name: pseudonym }
      : { kind: "anonymous" };
    setSending(true);
    const result = await sendSubmission(newSubmission(text, attribution));
    setSending(false);
    if (result.ok) setSent(result.value);
    else refuse(describe(result.error));
  };

  if (sent !== null)
    return (
      <>
        <h2 ref={sentHeading} tabIndex={-1} className="mt-6 text-subtitle">
          {t("submit.sent")}
        </h2>
        <p className="mt-2">{t("submit.sentBody")}</p>
        <p className="mt-4">
          <Link to="/profile/account" className="inline-flex min-h-11 items-center underline">
            {t("submit.mine")}
          </Link>
        </p>
      </>
    );

  const licence = t(`submit.${origin}.name`);
  const by = signed && name.trim() !== "" ? t("submit.by", { name: name.trim() }) : null;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {problem !== null && (
        <p ref={alert} role="alert" tabIndex={-1} className="mt-6 text-danger">
          {problem}
        </p>
      )}
      <section aria-labelledby={`${id}-licence`} className="mt-6">
        <h2 id={`${id}-licence`} className="font-semibold">
          {t("submit.licence")}
        </h2>
        <p className="mt-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border-strong px-2 text-caption font-semibold">
            {licence}
          </span>
          <span className="text-small text-muted">{t("submit.licenceFixed")}</span>
        </p>
        <ul className="mt-2 list-disc pl-5">
          <li>{t(`submit.${origin}.line1`)}</li>
          <li>{t(`submit.${origin}.line2`)}</li>
          <li>{t(`submit.${origin}.line3`)}</li>
        </ul>
        <p className="mt-2">
          <NewTabLink href={t(`submit.${origin}.url`)}>{t(`submit.${origin}.link`)}</NewTabLink>
        </p>
      </section>
      <fieldset className="mt-6 min-w-0" aria-describedby={`${id}-identity`}>
        <legend className="font-semibold">{t("submit.signature")}</legend>
        <p id={`${id}-identity`} className="text-small text-muted">
          {t("pseudonym.identity", { ns: "auth" })}
        </p>
        {[false, true].map((choice) => (
          <label key={String(choice)} className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="radio"
              name={`${id}-signature`}
              checked={signed === choice}
              onChange={() => {
                setSigned(choice);
              }}
              className="size-5 flex-none accent-ink"
            />
            {!choice
              ? t("submit.anonymous")
              : account.pseudonym === null
                ? t("submit.pseudonym")
                : t("submit.pseudonymCurrent", { name: account.pseudonym })}
          </label>
        ))}
        {signed && account.pseudonym === null && (
          <div className="mt-2 flex flex-col gap-2">
            <label htmlFor={`${id}-pseudonym`} className="font-semibold">
              {t("submit.pseudonymField")}
            </label>
            <input
              id={`${id}-pseudonym`}
              value={name}
              maxLength={PSEUDONYM_MAX}
              autoComplete="nickname"
              aria-describedby={`${id}-pseudonym-help`}
              onChange={(event) => {
                setName(event.currentTarget.value);
              }}
              className={fieldClass}
            />
            <p id={`${id}-pseudonym-help`} className="text-small text-muted">
              {t("submit.pseudonymHelp", { max: PSEUDONYM_MAX })}
            </p>
          </div>
        )}
      </fieldset>
      <fieldset className="mt-6 min-w-0" aria-describedby={`${id}-attestation-help`}>
        <legend className="font-semibold">{t("submit.attestation")}</legend>
        <p id={`${id}-attestation-help`} className="text-small text-muted">
          {t("submit.attestationHelp")}
        </p>
        {STATEMENTS[origin].map((statement) => (
          <label key={statement} className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={ticked.has(statement)}
              onChange={(event) => {
                const { checked } = event.currentTarget;
                setTicked((before) =>
                  checked
                    ? new Set([...before, statement])
                    : new Set([...before].filter((other) => other !== statement)),
                );
              }}
              className="size-5 flex-none accent-ink"
            />
            {t(`submit.statement.${statement}`)}
          </label>
        ))}
      </fieldset>
      <p className="mt-4">{t("submit.privacy")}</p>
      <section aria-labelledby={`${id}-preview`} className="mt-6">
        <h2 id={`${id}-preview`} className="font-semibold">
          {t("submit.preview")}
        </h2>
        <div className="mt-2 flex flex-col gap-1 rounded-card border border-hairline bg-surface p-4">
          <p lang="zh-Hans" className="font-zh font-semibold">
            {text.title}
          </p>
          {text.source === "ai" && <AiBadge provenance={text.provenance} />}
          <p className="text-small">
            {t(`submit.${origin}.origin`)} · {by ?? t("submit.anonymous")}
          </p>
          <p className="text-small text-muted">{licence}</p>
        </div>
      </section>
      <div className="mt-6">
        <Button type="submit" aria-disabled={sending}>
          {t("submit.send")}
        </Button>
      </div>
      <p role="status" className="mt-3 text-small">
        {sending ? t("submit.sending") : ""}
      </p>
    </form>
  );
};

/** Read › a text › « Soumettre à la bibliothèque » (ADR 0015). */
export const SubmitForm = ({ id }: { readonly id: string }) => {
  const { t } = useTranslation();
  const describe = useApiFailure();
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [round, setRound] = useState(0);

  useEffect(() => {
    let active = true;
    void Promise.all([loadText(database, id), loadAccount()]).then(([text, account]) => {
      if (!active) return;
      if (!text.ok) setLoaded({ status: "unreadable", reason: describeFailure(text.error) });
      else if (text.value === null) setLoaded({ status: "missing" });
      else if (text.value.source === "library") setLoaded({ status: "copied" });
      else if (!account.ok) setLoaded({ status: "failed", failure: account.error });
      else setLoaded({ status: "ready", text: text.value, account: account.value });
    });
    return () => {
      active = false;
    };
  }, [id, round]);

  return (
    <section className="max-w-2xl">
      <Link
        to="/read/$id"
        params={{ id }}
        className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1"
      >
        <ChevronLeft aria-hidden="true" className="size-5" />
        {t("submit.back")}
      </Link>
      <h1 className="text-title">{t("submit.title")}</h1>
      <p className="mt-2 text-muted">{t("submit.intro")}</p>
      {loaded.status === "loading" && (
        <p role="status" className="mt-4 text-muted">
          {t("submit.loading")}
        </p>
      )}
      {(loaded.status === "missing" || loaded.status === "unreadable") && (
        <p role="alert" className="mt-4 text-danger">
          {loaded.status === "missing"
            ? t("submit.textMissing")
            : t("submit.textFailed", { reason: loaded.reason })}
        </p>
      )}
      {loaded.status === "copied" && <p className="mt-4">{t("globalLibrary.notSubmittable")}</p>}
      {loaded.status === "failed" && (
        <div className="mt-4 flex flex-col items-start gap-2">
          <p role="alert" className="text-danger">
            {describe(loaded.failure)}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setLoaded({ status: "loading" });
              setRound((count) => count + 1);
            }}
          >
            {t("submit.retry")}
          </Button>
        </div>
      )}
      {loaded.status === "ready" && (
        <>
          <p className="mt-4">
            <span lang="zh-Hans" className="font-zh font-semibold">
              {loaded.text.title}
            </span>{" "}
            <span className="text-small text-muted">
              ({t("submit.characters", { count: characterCount(loaded.text.body) })})
            </span>
          </p>
          {loaded.account === null ? (
            <>
              <p className="mt-4">{t("submit.failure.signedOut")}</p>
              <p className="mt-2">
                <Link
                  to="/account/sign-in"
                  search={{ return: `/read/${id}/submit` }}
                  className="inline-flex min-h-11 items-center underline"
                >
                  {t("submit.signIn")}
                </Link>
              </p>
            </>
          ) : (
            <Form text={loaded.text} account={loaded.account} />
          )}
        </>
      )}
    </section>
  );
};
