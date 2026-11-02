import {
  NewNotice,
  NOTICE_REASONS,
  type NoticeReason,
  type NoticeReceipt,
  STATEMENT_MAX,
} from "@openlinguo/core/moderation";
import type { LibraryItem } from "@openlinguo/core/submission";
import { Link, useSearch } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ApiFailure } from "@/data/api";
import { loadLibraryItem } from "@/data/global-library";
import { sendNotice } from "@/data/notices";
import { fieldClass } from "@/shell/ai-settings";

export type ReportSearch = { readonly text: string | null };

/** `?text=` is the id of a text of the global library. */
export const validateReportSearch = (search: Record<string, unknown>): ReportSearch => {
  const text = search["text"];
  return { text: typeof text === "string" && text !== "" ? text : null };
};

const useReportFailure = () => {
  const { t } = useTranslation();
  return (failure: ApiFailure): string => {
    switch (failure.kind) {
      case "offline":
        return t("report.failure.offline");
      case "rate-limited":
        return t("report.failure.tooMany");
      case "unexpected":
        return t("report.failure.unexpected", { status: failure.status });
      case "refused":
        switch (failure.code) {
          case "TOO_MANY_ATTEMPTS":
            return t("report.failure.tooMany");
          case "NOT_FOUND":
            return t("report.failure.notFound");
          case "INVALID_REQUEST":
            return t("report.failure.invalid");
          default:
            return t("report.failure.unexpected", { status: failure.code });
        }
    }
  };
};

type Field = "reason" | "explanation" | "name" | "email" | "goodFaith";
const FIELDS: readonly Field[] = ["reason", "explanation", "name", "email", "goodFaith"];

const Receipt = ({
  receipt,
  email,
}: {
  readonly receipt: NoticeReceipt;
  readonly email: string;
}) => {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <>
      <h2 ref={heading} tabIndex={-1} className="mt-6 text-subtitle">
        {t("report.sent")}
      </h2>
      <p className="mt-2 font-semibold">{t("report.number", { id: receipt.id })}</p>
      <p className="mt-2">{t("report.next")}</p>
      <p className={receipt.receipt === "failed" ? "mt-2 text-danger" : "mt-2"}>
        {t(`report.receipt.${receipt.receipt}`, { email })}
      </p>
      <p className="mt-4">
        <Link to="/read/library" className="inline-flex min-h-11 items-center underline">
          {t("report.toLibrary")}
        </Link>
      </p>
    </>
  );
};

const Form = ({ text }: { readonly text: LibraryItem }) => {
  const { t } = useTranslation();
  const describe = useReportFailure();
  const id = useId();
  const [reason, setReason] = useState<NoticeReason | "">("");
  const [explanation, setExplanation] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [goodFaith, setGoodFaith] = useState(false);
  const [invalid, setInvalid] = useState<ReadonlySet<Field>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState<NoticeReceipt | null>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const optional = reason === "child-sexual-abuse";

  useEffect(() => {
    if (attempt > 0) alert.current?.focus();
  }, [attempt]);

  const refuse = (message: string) => {
    setProblem(message);
    setAttempt((count) => count + 1);
  };

  const send = async () => {
    if (sending) return;
    const parsed = NewNotice.safeParse({
      submissionId: text.id,
      reason: reason === "" ? null : reason,
      explanation,
      name: name.trim() === "" ? null : name,
      email: email.trim() === "" ? null : email.trim(),
      goodFaith: goodFaith ? true : null,
    });
    if (!parsed.success) {
      const wrong = new Set(
        parsed.error.issues.flatMap(({ path }) => FIELDS.filter((field) => field === path[0])),
      );
      setInvalid(wrong);
      const first = FIELDS.find((field) => wrong.has(field)) ?? "explanation";
      refuse(t(`report.failure.${first}`));
      return;
    }
    setInvalid(new Set());
    setSending(true);
    const result = await sendNotice(parsed.data);
    setSending(false);
    if (result.ok) setReceipt(result.value);
    else refuse(describe(result.error));
  };

  if (receipt !== null) return <Receipt receipt={receipt} email={email.trim()} />;

  const identityField = (field: "name" | "email", value: string, set: (value: string) => void) => (
    <div className="mt-4 flex flex-col gap-2">
      <label htmlFor={`${id}-${field}`} className="font-semibold">
        {t(`report.${field}`)}
      </label>
      <input
        id={`${id}-${field}`}
        type={field === "email" ? "email" : "text"}
        autoComplete={field}
        value={value}
        aria-invalid={invalid.has(field)}
        aria-describedby={`${id}-identity`}
        onChange={(event) => {
          set(event.currentTarget.value);
        }}
        className={fieldClass}
      />
    </div>
  );

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
      <div className="mt-6 flex flex-col gap-2">
        <label htmlFor={`${id}-reason`} className="font-semibold">
          {t("report.reason")}
        </label>
        <select
          id={`${id}-reason`}
          value={reason}
          aria-invalid={invalid.has("reason")}
          onChange={(event) => {
            const value = NOTICE_REASONS.find((option) => option === event.currentTarget.value);
            setReason(value ?? "");
          }}
          className={fieldClass}
        >
          <option value="">{t("report.choose")}</option>
          {NOTICE_REASONS.map((option) => (
            <option key={option} value={option}>
              {t(`report.reasons.${option}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <label htmlFor={`${id}-explanation`} className="font-semibold">
          {t("report.explanation")}
        </label>
        <textarea
          id={`${id}-explanation`}
          value={explanation}
          rows={5}
          aria-invalid={invalid.has("explanation")}
          aria-describedby={`${id}-explanation-help`}
          onChange={(event) => {
            setExplanation(event.currentTarget.value);
          }}
          className={`${fieldClass} py-2`}
        />
        <p id={`${id}-explanation-help`} className="text-small text-muted">
          {t("report.explanationHelp", { max: STATEMENT_MAX })}
        </p>
      </div>
      <fieldset className="mt-4 min-w-0">
        <legend className="font-semibold">{t("report.identity")}</legend>
        <p id={`${id}-identity`} className="text-small text-muted">
          {optional ? t("report.identityOptional") : t("report.identityHelp")}
        </p>
        {identityField("name", name, setName)}
        {identityField("email", email, setEmail)}
      </fieldset>
      <label className="mt-6 flex min-h-11 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={goodFaith}
          aria-invalid={invalid.has("goodFaith")}
          onChange={(event) => {
            setGoodFaith(event.currentTarget.checked);
          }}
          className="size-5 flex-none accent-ink"
        />
        {t("report.goodFaith")}
      </label>
      <p className="mt-4 rounded-card border border-hairline bg-sunken p-4">
        {t("report.warning")}
      </p>
      <div className="mt-6">
        <Button type="submit" aria-disabled={sending}>
          {t("report.send")}
        </Button>
      </div>
      <p role="status" className="mt-3 text-small">
        {sending ? t("report.sending") : ""}
      </p>
    </form>
  );
};

type Loaded =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly failure: ApiFailure }
  | { readonly status: "ready"; readonly text: LibraryItem };

/** `/report`: « Signaler », with no account (DSA art. 16, #267 mockups). */
export const ReportPage = () => {
  const { t } = useTranslation();
  const describe = useReportFailure();
  const { text: textId } = validateReportSearch(useSearch({ strict: false }));
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (textId === null) return;
    let active = true;
    void loadLibraryItem(textId).then((result) => {
      if (!active) return;
      setLoaded(
        result.ok
          ? { status: "ready", text: result.value }
          : { status: "failed", failure: result.error },
      );
    });
    return () => {
      active = false;
    };
  }, [textId, round]);

  return (
    <section className="max-w-2xl">
      {textId === null ? (
        <Link to="/read/library" className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1">
          <ChevronLeft aria-hidden="true" className="size-5" />
          {t("report.toLibrary")}
        </Link>
      ) : (
        <Link
          to="/read/library/$id"
          params={{ id: textId }}
          className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1"
        >
          <ChevronLeft aria-hidden="true" className="size-5" />
          {t("report.back")}
        </Link>
      )}
      <h1 className="text-title">{t("report.title")}</h1>
      <p className="mt-2 text-muted">{t("report.intro")}</p>
      {textId === null && (
        <p role="alert" className="mt-4 text-danger">
          {t("report.missing")}
        </p>
      )}
      {textId !== null && loaded.status === "loading" && (
        <p role="status" className="mt-4 text-muted">
          {t("globalLibrary.loading")}
        </p>
      )}
      {textId !== null && loaded.status === "failed" && (
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
            {t("globalLibrary.retry")}
          </Button>
        </div>
      )}
      {loaded.status === "ready" && (
        <>
          <dl className="mt-6 rounded-card border border-hairline bg-surface p-4">
            <dt className="font-semibold">{t("report.text")}</dt>
            <dd lang="zh-Hans" className="font-zh wrap-anywhere">
              {loaded.text.title}
            </dd>
            <dt className="mt-2 font-semibold">{t("report.address")}</dt>
            <dd className="text-small wrap-anywhere">
              {`${window.location.origin}/read/library/${loaded.text.id}`}
            </dd>
          </dl>
          <Form text={loaded.text} />
        </>
      )}
    </section>
  );
};
