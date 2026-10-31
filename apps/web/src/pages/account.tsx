import type { Submission } from "@openlinguo/core/submission";
import { Link } from "@tanstack/react-router";
import { Check, ChevronLeft, Clock, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApiFailure } from "@/components/submit-form";
import { Button } from "@/components/ui/button";
import { type ApiFailure, listSubmissions, withdrawSubmission } from "@/data/submissions";
import { cn } from "@/lib/utils";

type Listed =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly failure: ApiFailure }
  | { readonly status: "ready"; readonly submissions: readonly Submission[] };

const StatusPill = ({ status }: { readonly status: Submission["status"] }) => {
  const { t } = useTranslation();
  const Icon = status === "pending" ? Clock : status === "approved" ? Check : X;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 self-start rounded-full border px-2 py-0.5 text-caption font-semibold",
        status === "pending" ? "border-dashed border-border-strong text-muted" : "border-ink",
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 flex-none" />
      {t(`account.status.${status}`)}
    </span>
  );
};

/** Profile › Compte: for now « Mes textes envoyés »; #272 adds sign-in and the pseudonym. */
export const AccountPage = () => {
  const { t, i18n } = useTranslation();
  const describe = useApiFailure();
  const [listed, setListed] = useState<Listed>({ status: "loading" });
  const [round, setRound] = useState(0);
  const [notice, setNotice] = useState<{ readonly text: string; readonly failed: boolean } | null>(
    null,
  );
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    void listSubmissions().then((result) => {
      if (!active) return;
      setListed(
        result.ok
          ? { status: "ready", submissions: result.value }
          : { status: "failed", failure: result.error },
      );
    });
    return () => {
      active = false;
    };
  }, [round]);

  const withdraw = async (submission: Submission) => {
    const result = await withdrawSubmission(submission.id);
    if (!result.ok) {
      setNotice({ text: describe(result.error), failed: true });
      return;
    }
    setListed((before) =>
      before.status === "ready"
        ? {
            status: "ready",
            submissions: before.submissions.filter(({ id }) => id !== submission.id),
          }
        : before,
    );
    setNotice({ text: t("account.withdrawn", { title: submission.title }), failed: false });
    heading.current?.focus();
  };

  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "long" });
  return (
    <section className="max-w-2xl">
      <Link to="/profile" className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1">
        <ChevronLeft aria-hidden="true" className="size-5" />
        {t("profile.title")}
      </Link>
      <h1 className="text-title">{t("account.title")}</h1>
      <h2 ref={heading} tabIndex={-1} className="mt-8 text-subtitle">
        {t("account.submissions")}
      </h2>
      <p role="status" className="mt-2">
        {notice?.failed === false ? notice.text : ""}
      </p>
      {notice?.failed === true && (
        <p role="alert" className="mt-2 text-danger">
          {notice.text}
        </p>
      )}
      {listed.status === "loading" && <p className="mt-2 text-muted">{t("account.loading")}</p>}
      {listed.status === "failed" && (
        <div className="mt-2 flex flex-col items-start gap-2">
          <p role="alert" className="text-danger">
            {describe(listed.failure)}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setListed({ status: "loading" });
              setRound((count) => count + 1);
            }}
          >
            {t("submit.retry")}
          </Button>
        </div>
      )}
      {listed.status === "ready" &&
        (listed.submissions.length === 0 ? (
          <p className="mt-2 text-muted">{t("account.none")}</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {listed.submissions.map((submission) => (
              <li
                key={submission.id}
                className="flex flex-col gap-2 rounded-card border border-hairline bg-surface p-4"
              >
                <p lang="zh-Hans" className="font-zh font-semibold">
                  {submission.title}
                </p>
                <StatusPill status={submission.status} />
                <p className="text-small text-muted">
                  {t("account.sentOn", { date: date.format(new Date(submission.createdAt)) })}
                </p>
                {submission.status === "pending" && (
                  <Button
                    variant="outline"
                    className="self-start"
                    aria-label={t("account.withdrawLabel", { title: submission.title })}
                    onClick={() => void withdraw(submission)}
                  >
                    {t("account.withdraw")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
};
