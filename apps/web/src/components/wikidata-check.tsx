import type { WikidataError } from "@openlinguo/core";
import { CircleAlert, Info, LoaderCircle, Send } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { database } from "@/data/database";
import { describeFailure } from "@/data/review-log";
import type { UnknownWord } from "@/data/unknown-words";
import {
  checkOnWikidata,
  markWikidataNoticeSeen,
  toCheck,
  wikidataNoticeSeen,
} from "@/data/wikidata-check";

type Outcome =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "checked"; readonly count: number; readonly found: number }
  | { readonly kind: "cancelled"; readonly count: number }
  | { readonly kind: "failed"; readonly error: WikidataError; readonly count: number }
  | { readonly kind: "storage"; readonly reason: string };

const NoticeDialog = ({
  onConfirm,
  onCancel,
}: {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) => {
  const { t } = useTranslation();
  const confirmed = useRef(false);
  return (
    <Dialog
      title={t("wikidata.notice.title")}
      description={t("wikidata.notice.intro")}
      sheet={null}
      onClose={() => {
        if (confirmed.current) onConfirm();
        else onCancel();
      }}
    >
      {(close) => (
        <>
          <h3 className="mt-4 font-semibold">{t("wikidata.notice.whatIsSent")}</h3>
          <ul className="mt-2 flex list-disc flex-col gap-1 ps-5">
            <li>{t("wikidata.notice.sent")}</li>
            <li>{t("wikidata.notice.recipient")}</li>
            <li>{t("wikidata.notice.when")}</li>
          </ul>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                confirmed.current = true;
                close();
              }}
            >
              {t("wikidata.notice.confirm")}
            </Button>
            <Button variant="outline" onClick={close}>
              {t("wikidata.notice.cancel")}
            </Button>
          </div>
          <p className="mt-3 text-small text-muted">{t("wikidata.notice.once")}</p>
        </>
      )}
    </Dialog>
  );
};

/**
 * « Search on Wikidata » for the sequences that have no answer yet: one click, after the notice the
 * first time. Every answer is kept by `checkOnWikidata`; `onChecked` lets the panel list again.
 */
export const WikidataCheck = ({
  words,
  onChecked,
}: {
  readonly words: readonly UnknownWord[];
  readonly onChecked: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const sentId = useId();
  const search = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const stop = useRef<AbortController | null>(null);
  const wasRunning = useRef(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<readonly string[] | null>(null);
  const [notRemembered, setNotRemembered] = useState<string | null>(null);

  const pending = toCheck(words).filter((sequence) => !answered.has(sequence));
  const running = outcome.kind === "running";

  useEffect(() => {
    if (running) cancel.current?.focus();
    else if (wasRunning.current) search.current?.focus();
    wasRunning.current = running;
  }, [running]);

  useEffect(
    () => () => {
      stop.current?.abort();
    },
    [],
  );

  const run = async (sequences: readonly string[]): Promise<void> => {
    const controller = new AbortController();
    stop.current = controller;
    setOutcome({ kind: "running" });
    const result = await checkOnWikidata(database, sequences, i18n.language, controller.signal);
    stop.current = null;
    if (!result.ok) {
      setOutcome({ kind: "storage", reason: describeFailure(result.error) });
      onChecked();
      return;
    }
    const { answered: kept, found, error } = result.value;
    setAnswered(new Set([...answered, ...kept]));
    if (error === null) setOutcome({ kind: "checked", count: kept.length, found });
    else if (error.kind === "aborted") setOutcome({ kind: "cancelled", count: kept.length });
    else setOutcome({ kind: "failed", error, count: kept.length });
    onChecked();
  };

  const ask = (): void => {
    if (running || pending.length === 0) return;
    setNotRemembered(null);
    void wikidataNoticeSeen(database).then((seen) => {
      // Unreadable is shown again: the notice is never skipped.
      if (seen.ok && seen.value) void run(pending);
      else setConfirming(pending);
    });
  };

  const confirm = async (sequences: readonly string[]): Promise<void> => {
    setConfirming(null);
    const marked = await markWikidataNoticeSeen(database);
    if (!marked.ok) {
      setNotRemembered(
        t("wikidata.notice.notRemembered", { reason: describeFailure(marked.error) }),
      );
    }
    void run(sequences);
  };

  const status = (): string => {
    switch (outcome.kind) {
      case "running":
        return t("wikidata.searching");
      case "checked":
        return t("wikidata.checked", { count: outcome.count, found: outcome.found });
      case "cancelled":
        return t("wikidata.cancelled", { count: outcome.count });
      case "idle":
      case "failed":
      case "storage":
        return "";
    }
  };

  const failure = (): string | null => {
    if (outcome.kind === "storage") return t("wikidata.storageFailed", { reason: outcome.reason });
    if (outcome.kind !== "failed") return null;
    const kind = outcome.error.kind;
    if (kind === "aborted") return null;
    return [
      t(`wikidata.failed.${kind}`, { status: outcome.error.status ?? "" }),
      outcome.count > 0 ? t("wikidata.kept", { count: outcome.count }) : "",
      t("wikidata.retry"),
    ]
      .filter((sentence) => sentence !== "")
      .join(" ");
  };
  const failed = failure();

  return (
    <section className="mt-4">
      <p className="text-muted">{t("wikidata.intro")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          ref={search}
          aria-describedby={sentId}
          aria-disabled={running || pending.length === 0}
          onClick={ask}
        >
          {running && (
            <LoaderCircle aria-hidden="true" className="size-4.5 motion-safe:animate-spin" />
          )}
          {running ? t("wikidata.searching") : t("wikidata.search")}
        </Button>
        {running && (
          <Button
            ref={cancel}
            variant="outline"
            onClick={() => {
              stop.current?.abort();
            }}
          >
            {t("wikidata.cancel")}
          </Button>
        )}
      </div>
      <p id={sentId} className="mt-2 flex items-start gap-1.5 text-small text-muted">
        <Send aria-hidden="true" className="mt-0.5 size-4 flex-none" />
        <span>
          {pending.length === 0 ? (
            t("wikidata.nothingToSend")
          ) : (
            <Trans
              i18nKey="wikidata.sent"
              values={{ sequences: pending.join("、") }}
              components={[<span key="sequences" lang="zh-Hans" className="font-zh" />]}
            />
          )}
        </span>
      </p>
      <p role="status" className="mt-3">
        {status()}
      </p>
      {failed !== null && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-card border-2 border-danger bg-surface px-4 py-3"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-5 flex-none text-danger" />
          <p>{failed}</p>
        </div>
      )}
      {notRemembered !== null && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-small text-danger">
          <Info aria-hidden="true" className="mt-0.5 size-4 flex-none" />
          {notRemembered}
        </p>
      )}
      {confirming !== null && (
        <NoticeDialog
          onConfirm={() => {
            void confirm(confirming);
          }}
          onCancel={() => {
            setConfirming(null);
          }}
        />
      )}
    </section>
  );
};
