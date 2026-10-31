import { proficiencyFrameworks, type Result } from "@openlinguo/core";
import {
  type BandEstimate,
  GROUNDS,
  type Ground,
  isLegalGround,
  isTermsGround,
  LEGAL_GROUNDS,
  MODERATION_CHECKS,
  type ModerationCheck,
  type Restriction,
  TERMS_CLAUSES,
} from "@openlinguo/core/moderation";
import { characterCount, type Submission } from "@openlinguo/core/submission";
import { Link, useParams } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiBadge } from "@/components/ai-badge";
import { Button } from "@/components/ui/button";
import { useData } from "@/data/data-context";
import { database } from "@/data/database";
import {
  approveSubmission,
  estimateText,
  loadForReview,
  loadQueue,
  restrictSubmission,
} from "@/data/moderation";
import type { ApiFailure } from "@/data/api";
import { describeCoverageFailure } from "@/data/text-coverage";
import { fieldClass } from "@/shell/ai-settings";

const useFailure = () => {
  const { t } = useTranslation("moderation");
  return (failure: ApiFailure): string => {
    if (failure.kind === "offline") return t("failure.offline");
    if (failure.kind === "unexpected") return t("failure.unexpected", { status: failure.status });
    switch (failure.code) {
      case "UNAUTHORIZED":
        return t("failure.signedOut");
      case "TWO_FACTOR_REQUIRED":
        return t("failure.twoFactor");
      case "ADMIN_REQUIRED":
        return t("failure.admin");
      case "AGE_DECLARATION_REQUIRED":
        return t("failure.age");
      case "NOT_FOUND":
        return t("failure.notFound");
      case "SUBMISSION_NOT_PENDING":
        return t("failure.notPending");
      case "SUBMISSION_NOT_APPROVED":
        return t("failure.notApproved");
      case "MAIL_FAILED":
        return t("failure.mail");
      case "INVALID_REQUEST":
        return t("failure.invalid");
      default:
        return t("failure.unexpected", { status: failure.code });
    }
  };
};

/** Sign-in and the authenticator code live in Compte (#272). */
const needsAccount = (failure: ApiFailure) =>
  failure.kind === "refused" &&
  (failure.code === "UNAUTHORIZED" ||
    failure.code === "TWO_FACTOR_REQUIRED" ||
    failure.code === "AGE_DECLARATION_REQUIRED");

type Loaded<T> =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly failure: ApiFailure }
  | { readonly status: "ready"; readonly value: T };

/** `load` is a module-level function of `key`, so it never changes between renders. */
const useLoaded = <T,>(load: (key: string) => Promise<Result<T, ApiFailure>>, key: string) => {
  const [loaded, setLoaded] = useState<Loaded<T>>({ status: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let active = true;
    void load(key).then((result) => {
      if (!active) return;
      setLoaded(
        result.ok
          ? { status: "ready", value: result.value }
          : { status: "failed", failure: result.error },
      );
    });
    return () => {
      active = false;
    };
  }, [load, key, round]);
  const retry = () => {
    setLoaded({ status: "loading" });
    setRound((count) => count + 1);
  };
  return [loaded, retry] as const;
};

const LoadFailure = ({
  failure,
  onRetry,
}: {
  readonly failure: ApiFailure;
  readonly onRetry: () => void;
}) => {
  const { t } = useTranslation("moderation");
  const describe = useFailure();
  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <p role="alert" className="text-danger">
        {describe(failure)}
      </p>
      {needsAccount(failure) && (
        <Link to="/profile/account" className="inline-flex min-h-11 items-center underline">
          {t("account")}
        </Link>
      )}
      <Button variant="outline" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  );
};

const BackLink = ({
  to,
  children,
}: {
  readonly to: "/profile/account" | "/admin";
  readonly children: ReactNode;
}) => (
  <Link to={to} className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1">
    <ChevronLeft aria-hidden="true" className="size-5" />
    {children}
  </Link>
);

const Details = ({ submission }: { readonly submission: Submission }) => {
  const { t, i18n } = useTranslation("moderation");
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" });
  return (
    <>
      {submission.origin === "ai" && <AiBadge provenance={submission.provenance} />}
      <p className="text-small">
        {t(`origin.${submission.origin}`)} ·{" "}
        {submission.attribution === null
          ? t("anonymous")
          : t("by", { name: submission.attribution })}
      </p>
      <p className="text-small text-muted">
        {t("sentOn", { date: date.format(new Date(submission.createdAt)) })} ·{" "}
        {t("characters", { count: characterCount(submission.body) })} ·{" "}
        {t("licence", { licence: submission.licence })}
      </p>
    </>
  );
};

/** `/admin`: the texts awaiting review, oldest first (ADR 0015). */
export const AdminQueuePage = () => {
  const { t } = useTranslation("moderation");
  const [queue, retry] = useLoaded(loadQueue, "queue");
  return (
    <section className="max-w-[880px]">
      <BackLink to="/profile/account">{t("account")}</BackLink>
      <h1 className="text-title">{t("title")}</h1>
      <h2 className="mt-6 text-subtitle">{t("queue")}</h2>
      <p className="mt-2 text-muted">{t("queueIntro")}</p>
      {queue.status === "loading" && (
        <p role="status" className="mt-4 text-muted">
          {t("loading")}
        </p>
      )}
      {queue.status === "failed" && <LoadFailure failure={queue.failure} onRetry={retry} />}
      {queue.status === "ready" &&
        (queue.value.length === 0 ? (
          <p className="mt-4 text-muted">{t("empty")}</p>
        ) : (
          <ol className="mt-4 flex flex-col gap-3">
            {queue.value.map((submission) => (
              <li
                key={submission.id}
                className="flex flex-col gap-2 rounded-card border border-hairline bg-surface p-4"
              >
                <Link
                  to="/admin/$id"
                  params={{ id: submission.id }}
                  className="inline-flex min-h-11 items-center font-zh font-semibold underline"
                  lang="zh-Hans"
                >
                  {submission.title}
                </Link>
                <Details submission={submission} />
              </li>
            ))}
          </ol>
        ))}
    </section>
  );
};

type Estimate =
  | { readonly status: "measuring" }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "ready"; readonly estimate: BandEstimate | null };

/** Computed in the admin's browser with `core` and `lang-zh` (ADR 0015). */
const useEstimate = (body: string): Estimate | null => {
  const { state } = useData();
  const feature = state.status === "ready" ? state.pack.features.textReading : null;
  const [estimate, setEstimate] = useState<Estimate>({ status: "measuring" });
  useEffect(() => {
    if (feature === null) return;
    let active = true;
    void estimateText(database, feature, body).then((result) => {
      if (!active) return;
      setEstimate(
        result.ok
          ? { status: "ready", estimate: result.value }
          : { status: "failed", reason: describeCoverageFailure(result.error) },
      );
    });
    return () => {
      active = false;
    };
  }, [feature, body]);
  return feature === null ? null : estimate;
};

const bandName = (band: number): string =>
  proficiencyFrameworks["hsk-2025"][band - 1] ?? String(band);

const LevelSection = ({ estimate }: { readonly estimate: Estimate | null }) => {
  const { t, i18n } = useTranslation("moderation");
  const id = useId();
  const percent = new Intl.NumberFormat(i18n.language, {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const ready = estimate?.status === "ready" ? estimate.estimate : null;
  return (
    <section aria-labelledby={`${id}-level`} className="mt-6">
      <h2 id={`${id}-level`} className="font-semibold">
        {t("level.title")}
      </h2>
      {estimate === null && <p className="mt-2 text-muted">{t("level.unavailable")}</p>}
      {estimate?.status === "measuring" && (
        <p role="status" className="mt-2 text-muted">
          {t("level.measuring")}
        </p>
      )}
      {estimate?.status === "failed" && (
        <p role="alert" className="mt-2 text-danger">
          {t("level.failed", { reason: estimate.reason })}
        </p>
      )}
      {estimate?.status === "ready" && ready === null && <p className="mt-2">{t("level.none")}</p>}
      {ready !== null && (
        <>
          <p className="mt-2">
            <span className="rounded-full border border-border-strong px-2 py-0.5 text-caption font-semibold">
              {t("level.band", { band: bandName(ready.band) })}
            </span>
          </p>
          <p className="mt-2 text-small text-muted">{t("level.rule")}</p>
          <table className="mt-3 w-full max-w-sm text-small">
            <caption className="text-left font-semibold">{t("level.caption")}</caption>
            <thead>
              <tr className="border-b border-hairline text-left">
                <th scope="col" className="py-1">
                  {t("level.levelHeader")}
                </th>
                <th scope="col" className="py-1 text-right">
                  {t("level.wordsHeader")}
                </th>
                <th scope="col" className="py-1 text-right">
                  {t("level.shareHeader")}
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ...ready.byLevel.map((count, index) => ({
                  label: t("level.level", { band: bandName(index + 1) }),
                  count,
                })),
                { label: t("level.outside"), count: ready.outside },
              ].map(({ label, count }) => (
                <tr key={label} className="border-b border-hairline">
                  <th scope="row" className="py-1 text-left font-normal">
                    {label}
                  </th>
                  <td className="py-1 text-right tabular-nums">{count}</td>
                  <td className="py-1 text-right tabular-nums">
                    {percent.format(count / ready.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="py-1 text-left">
                  {t("level.total")}
                </th>
                <td className="py-1 text-right tabular-nums">{ready.total}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </>
      )}
    </section>
  );
};

/** Moves focus to an alert each time it is raised again. */
const useAlert = () => {
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (attempt > 0) ref.current?.focus();
  }, [attempt]);
  const raise = (message: string) => {
    setProblem(message);
    setAttempt((count) => count + 1);
  };
  const node =
    problem === null ? null : (
      <p ref={ref} role="alert" tabIndex={-1} className="mt-4 text-danger">
        {problem}
      </p>
    );
  return { raise, node };
};

const StatementForm = ({
  submission,
  measure,
  onDecided,
}: {
  readonly submission: Submission;
  readonly measure: Restriction;
  readonly onDecided: () => void;
}) => {
  const { t } = useTranslation("moderation");
  const describe = useFailure();
  const id = useId();
  const alert = useAlert();
  const [ground, setGround] = useState<Ground | "">("");
  const [facts, setFacts] = useState("");
  const [explanation, setExplanation] = useState("");
  const [sending, setSending] = useState(false);
  const [checked, setChecked] = useState(false);

  const send = async () => {
    if (sending) return;
    setChecked(true);
    if (ground === "") {
      alert.raise(t("failure.ground"));
      return;
    }
    if (facts.trim() === "") {
      alert.raise(t("failure.facts"));
      return;
    }
    if (explanation.trim() === "") {
      alert.raise(t("failure.explanation"));
      return;
    }
    setSending(true);
    const result = await restrictSubmission(submission.id, measure, {
      ground,
      facts,
      explanation,
    });
    setSending(false);
    if (result.ok) onDecided();
    else alert.raise(describe(result.error));
  };

  const fixed = (label: string, value: string) => (
    <div className="mt-3">
      <dt className="font-semibold">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
  return (
    <form
      noValidate
      aria-labelledby={`${id}-title`}
      className="mt-6 rounded-card border border-hairline bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <h2 id={`${id}-title`} className="text-subtitle">
        {t("statement.title")}
      </h2>
      <p className="mt-1 text-small text-muted">{t("statement.intro")}</p>
      {alert.node}
      <dl>
        {fixed(
          t("statement.measure"),
          measure === "rejected" ? t("statement.measureRejected") : t("statement.measureRemoved"),
        )}
        {fixed(t("statement.source"), t("statement.sourceValue"))}
      </dl>
      <div className="mt-4 flex flex-col gap-2">
        <label htmlFor={`${id}-ground`} className="font-semibold">
          {t("statement.ground")}
        </label>
        <select
          id={`${id}-ground`}
          value={ground}
          aria-invalid={checked && ground === ""}
          onChange={(event) => {
            const value = GROUNDS.find((option) => option === event.currentTarget.value);
            setGround(value ?? "");
          }}
          className={fieldClass}
        >
          <option value="">{t("statement.choose")}</option>
          <optgroup label={t("statement.legal")}>
            {GROUNDS.filter(isLegalGround).map((option) => (
              <option key={option} value={option}>
                {t(`statement.grounds.${option}`)} ({LEGAL_GROUNDS[option]})
              </option>
            ))}
          </optgroup>
          <optgroup label={t("statement.terms")}>
            {GROUNDS.filter(isTermsGround).map((option) => (
              <option key={option} value={option}>
                {t("statement.clause", {
                  clause: TERMS_CLAUSES[option],
                  label: t(`statement.grounds.${option}`),
                })}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      {(
        [
          ["facts", facts, setFacts],
          ["explanation", explanation, setExplanation],
        ] as const
      ).map(([field, value, setValue]) => (
        <div key={field} className="mt-4 flex flex-col gap-2">
          <label htmlFor={`${id}-${field}`} className="font-semibold">
            {t(`statement.${field}`)}
          </label>
          <textarea
            id={`${id}-${field}`}
            value={value}
            rows={4}
            aria-describedby={`${id}-${field}-help`}
            aria-invalid={checked && value.trim() === ""}
            onChange={(event) => {
              setValue(event.currentTarget.value);
            }}
            className={`${fieldClass} py-2`}
          />
          <p id={`${id}-${field}-help`} className="text-small text-muted">
            {t(`statement.${field}Help`)}
          </p>
        </div>
      ))}
      <dl>
        {fixed(t("statement.automated"), t("statement.automatedValue"))}
        {fixed(t("statement.redress"), t("statement.redressValue"))}
      </dl>
      <div className="mt-6">
        <Button type="submit" aria-disabled={sending}>
          {measure === "rejected" ? t("statement.sendRejected") : t("statement.sendRemoved")}
        </Button>
      </div>
      <p role="status" className="mt-3 text-small">
        {sending ? t("statement.sending") : ""}
      </p>
    </form>
  );
};

type Done = { readonly kind: "approved"; readonly band: number } | { readonly kind: "restricted" };

const Decision = ({
  submission,
  estimate,
  onDone,
}: {
  readonly submission: Submission;
  readonly estimate: Estimate | null;
  readonly onDone: (done: Done) => void;
}) => {
  const { t } = useTranslation("moderation");
  const describe = useFailure();
  const id = useId();
  const alert = useAlert();
  const [ticked, setTicked] = useState<ReadonlySet<ModerationCheck>>(new Set());
  const [restricting, setRestricting] = useState(false);
  const [approving, setApproving] = useState(false);
  const band = estimate?.status === "ready" ? (estimate.estimate?.band ?? null) : null;
  const allTicked = MODERATION_CHECKS.every((check) => ticked.has(check));

  const approve = async () => {
    if (approving) return;
    if (!allTicked) {
      alert.raise(t("failure.unticked"));
      return;
    }
    if (band === null) {
      alert.raise(t("failure.noBand"));
      return;
    }
    setApproving(true);
    const result = await approveSubmission(submission.id, { band });
    setApproving(false);
    if (result.ok) onDone({ kind: "approved", band });
    else alert.raise(describe(result.error));
  };

  if (submission.status !== "pending" && submission.status !== "approved")
    return <p className="mt-6">{t("decided", { status: t(`status.${submission.status}`) })}</p>;
  const measure: Restriction = submission.status === "pending" ? "rejected" : "removed";
  return (
    <>
      {alert.node}
      {submission.status === "pending" && (
        <fieldset className="mt-6 min-w-0" aria-describedby={`${id}-help`}>
          <legend className="font-semibold">{t("checklist.title")}</legend>
          <p id={`${id}-help`} className="text-small text-muted">
            {t("checklist.help")}
          </p>
          {MODERATION_CHECKS.map((check) => (
            <label key={check} className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={ticked.has(check)}
                onChange={(event) => {
                  const { checked } = event.currentTarget;
                  setTicked((before) =>
                    checked
                      ? new Set([...before, check])
                      : new Set([...before].filter((other) => other !== check)),
                  );
                }}
                className="size-5 flex-none accent-ink"
              />
              {t(`checklist.items.${check}`)}
            </label>
          ))}
        </fieldset>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        {submission.status === "pending" && (
          <Button
            aria-disabled={!allTicked || band === null || approving}
            onClick={() => void approve()}
          >
            {t("approve")}
          </Button>
        )}
        <Button
          variant="outline"
          aria-expanded={restricting}
          onClick={() => {
            setRestricting((open) => !open);
          }}
        >
          {measure === "rejected" ? t("reject") : t("remove")}
        </Button>
      </div>
      <p role="status" className="mt-3 text-small">
        {approving ? t("approving") : ""}
      </p>
      {restricting && (
        <StatementForm
          submission={submission}
          measure={measure}
          onDecided={() => {
            onDone({ kind: "restricted" });
          }}
        />
      )}
    </>
  );
};

const Review = ({ submission }: { readonly submission: Submission }) => {
  const { t } = useTranslation("moderation");
  const id = useId();
  const estimate = useEstimate(submission.body);
  const [done, setDone] = useState<Done | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (done !== null) heading.current?.focus();
  }, [done]);

  if (done !== null)
    return (
      <>
        <h2 ref={heading} tabIndex={-1} className="mt-6 text-subtitle">
          {done.kind === "approved" ? t("approved") : t("statement.sent")}
        </h2>
        <p className="mt-2">
          {done.kind === "approved"
            ? t("approvedBody", { band: bandName(done.band) })
            : t("statement.sentBody")}
        </p>
        <p className="mt-4">
          <Link to="/admin" className="inline-flex min-h-11 items-center underline">
            {t("queue")}
          </Link>
        </p>
      </>
    );
  return (
    <div className="lg:grid lg:grid-cols-2 lg:gap-8">
      <section aria-labelledby={`${id}-text`} className="mt-6">
        <h2 id={`${id}-text`} className="font-semibold">
          {t("text")}
        </h2>
        <p lang="zh-Hans" className="mt-2 font-zh whitespace-pre-wrap">
          {submission.body}
        </p>
      </section>
      <div>
        <div className="mt-6 flex flex-col gap-2">
          <p className="text-small font-semibold">{t(`status.${submission.status}`)}</p>
          <Details submission={submission} />
        </div>
        <LevelSection estimate={estimate} />
        <Decision submission={submission} estimate={estimate} onDone={setDone} />
      </div>
    </div>
  );
};

/** The route param, checked: the router's param types resolve to `any`. */
const idParam = (params: unknown): string =>
  typeof params === "object" && params !== null && "id" in params && typeof params.id === "string"
    ? params.id
    : "";

/** `/admin/$id`: one text with its level, the checklist and the decision. */
export const AdminReviewPage = () => {
  const { t } = useTranslation("moderation");
  const id = idParam(useParams({ strict: false }));
  const [loaded, retry] = useLoaded(loadForReview, id);
  return (
    <section className="max-w-[1040px]">
      <BackLink to="/admin">{t("queue")}</BackLink>
      {loaded.status === "ready" ? (
        <h1 lang="zh-Hans" className="font-zh text-title">
          {loaded.value.title}
        </h1>
      ) : (
        <h1 className="text-title">{t("title")}</h1>
      )}
      {loaded.status === "loading" && (
        <p role="status" className="mt-4 text-muted">
          {t("loading")}
        </p>
      )}
      {loaded.status === "failed" && <LoadFailure failure={loaded.failure} onRetry={retry} />}
      {loaded.status === "ready" && <Review key={loaded.value.id} submission={loaded.value} />}
    </section>
  );
};
