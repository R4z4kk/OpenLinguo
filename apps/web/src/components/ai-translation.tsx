import {
  ok,
  type DictEntry,
  type GlossAnswer,
  type GlossInput,
  type PromptTask,
  type Result,
  type WordKey,
} from "@openlinguo/core";
import { readingKey } from "@openlinguo/lang-zh";
import { LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Trans, useTranslation } from "react-i18next";
import { AiBadge } from "@/components/ai-badge";
import { useAiNotice } from "@/components/ai-notice";
import { AiSent } from "@/components/ai-sent";
import { Button } from "@/components/ui/button";
import { deleteAiGloss, glossInput, loadAiGloss, translateEntry } from "@/data/ai-glosses";
import type { AiCall } from "@/data/ai-notice";
import { loadAiConnection, type AiConnection } from "@/data/ai-settings";
import { database, type StoredAiGloss } from "@/data/database";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";
import { AiFailure, type ShownError } from "@/shell/ai-settings";
import type { Language } from "@/i18n/language";

type Failure =
  | { readonly kind: "ai"; readonly error: ShownError }
  | { readonly kind: "storage"; readonly error: ReviewLogFailure };

/**
 * « Translate to French » under an entry without a French gloss, one entry per call (ADR 0012),
 * then the stored translation: `before` goes above the dictionary's glosses, `after` below them.
 */
export const useAiTranslation = ({
  entry,
  task,
  language,
  heading: Heading,
  container,
}: {
  readonly entry: DictEntry;
  readonly task: PromptTask<GlossInput, GlossAnswer> | null;
  readonly language: Language;
  readonly heading: "h2" | "h3";
  /** The glosses' container: focused after a deletion when the button is not offered. */
  readonly container: RefObject<HTMLDivElement | null>;
}): {
  readonly before: ReactNode;
  readonly after: ReactNode;
  readonly translated: boolean;
} => {
  const { t } = useTranslation();
  const notice = useAiNotice();
  const word = useMemo((): WordKey | null => {
    const key = entry.reading === null ? null : readingKey(entry.reading);
    return key?.ok === true ? { headword: entry.headword, readingKey: key.value } : null;
  }, [entry]);
  const input = useMemo(() => glossInput(entry), [entry]);
  const [connection, setConnection] = useState<Result<
    AiConnection | null,
    ReviewLogFailure
  > | null>(null);
  const [stored, setStored] = useState<Result<StoredAiGloss | null, ReviewLogFailure> | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [deleteFailure, setDeleteFailure] = useState<ReviewLogFailure | null>(null);
  const lifetime = useRef<AbortSignal | null>(null);
  const running = useRef(false);
  const focus = useRef<"heading" | "button" | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sentId = useId();

  useEffect(() => {
    if (word === null) return;
    const controller = new AbortController();
    lifetime.current = controller.signal;
    void loadAiGloss(database, word).then((result) => {
      if (!controller.signal.aborted) setStored(result);
    });
    void loadAiConnection(database).then((result) => {
      if (!controller.signal.aborted) setConnection(result);
    });
    // Leaving the page cancels a call in progress: nothing is stored.
    return () => {
      controller.abort();
    };
  }, [word]);

  useEffect(() => {
    if (focus.current === "heading") headingRef.current?.focus();
    if (focus.current === "button") (buttonRef.current ?? container.current)?.focus();
    focus.current = null;
  });

  const translate = async (
    current: AiConnection,
    key: WordKey,
    sent: GlossInput,
    prompt: PromptTask<GlossInput, GlossAnswer>,
  ): Promise<void> => {
    const signal = lifetime.current;
    // A double click must not send, and bill, a second call.
    if (signal === null || running.current) return;
    running.current = true;
    setBusy(true);
    setFailure(null);
    const result = await translateEntry(database, current, prompt, key, sent, signal, new Date());
    running.current = false;
    setBusy(false);
    if (signal.aborted) return;
    if (result.ok) {
      focus.current = "heading";
      setStored(ok(result.value));
    } else if (result.error.kind === "storage") {
      setFailure(result.error);
    } else {
      const { kind } = result.error.error;
      if (kind !== "aborted") setFailure({ kind: "ai", error: { ...result.error.error, kind } });
    }
  };

  const remove = async (key: WordKey): Promise<void> => {
    const result = await deleteAiGloss(database, key);
    if (!result.ok) {
      setDeleteFailure(result.error);
      return;
    }
    setDeleteFailure(null);
    focus.current = "button";
    setStored(ok(null));
  };

  const row = stored?.ok === true ? stored.value : null;
  const current = connection?.ok === true ? connection.value : null;
  const label = failure === null ? t("translate.action") : t("translate.retry");
  const call: AiCall | null =
    current === null || input === null
      ? null
      : {
          provider: current.endpoint.provider,
          action: label,
          payload: { feature: "translation", input },
        };
  const offered =
    stored?.ok === true && row === null && language === "fr" && task !== null && word !== null;

  const before =
    row === null || word === null ? null : (
      <div className="flex flex-col gap-3 rounded-card border border-hairline bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Heading ref={headingRef} tabIndex={-1} className="rounded-control font-semibold">
            {t("translate.heading")}
          </Heading>
          <AiBadge provenance={row.provenance} />
        </div>
        <ol className="list-decimal space-y-2 pl-8">
          {row.senses.map(({ english, french }, index) => (
            <li key={`${String(index)}\t${english}`}>
              <span lang="fr" className="block">
                {french}
              </span>
              <span className="block text-small text-muted">
                <Trans
                  i18nKey="translate.from"
                  values={{ source: english }}
                  components={[<span key="source" lang="en" />]}
                />
              </span>
            </li>
          ))}
        </ol>
        <p className="text-small text-muted">{t("translate.disclaimer")}</p>
        <div>
          <Button variant="ghost" onClick={() => void remove(word)}>
            <Trash2 aria-hidden="true" className="size-4.5" />
            {t("translate.delete")}
          </Button>
        </div>
        {deleteFailure !== null && (
          <p role="alert" className="text-danger">
            {t("translate.deleteFailed", { reason: describeFailure(deleteFailure) })}
          </p>
        )}
      </div>
    );

  const after = (
    <>
      {row !== null && <p className="text-small text-muted">{t("translate.onCards")}</p>}
      {offered && current !== null && call !== null && input !== null && (
        <div>
          <Button
            ref={buttonRef}
            variant="outline"
            aria-describedby={sentId}
            aria-disabled={busy}
            onClick={() => {
              if (!busy) notice.ask(call, () => void translate(current, word, input, task));
            }}
          >
            {busy && (
              <LoaderCircle aria-hidden="true" className="size-4.5 motion-safe:animate-spin" />
            )}
            {busy ? t("translate.pending") : label}
          </Button>
          <AiSent id={sentId} call={call} />
          {failure?.kind === "ai" && (
            <AiFailure provider={current.endpoint.provider} error={failure.error} />
          )}
          {failure?.kind === "storage" && (
            <p role="alert" className="mt-2 text-danger">
              {t("translate.saveFailed", { reason: describeFailure(failure.error) })}
            </p>
          )}
          <p className="mt-3 text-small text-muted">{t("translate.once")}</p>
        </div>
      )}
      {connection?.ok === false && (
        <p role="alert" className="text-danger">
          {t("ai.loadFailed", { reason: describeFailure(connection.error) })}
        </p>
      )}
      {stored?.ok === false && (
        <p role="alert" className="text-danger">
          {t("translate.loadFailed", { reason: describeFailure(stored.error) })}
        </p>
      )}
      {notice.view}
    </>
  );

  return {
    before,
    after,
    translated: word !== null && (stored === null || row !== null),
  };
};
