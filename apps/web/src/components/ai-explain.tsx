import {
  chat,
  type AiProvenance,
  type ExplainAnswer,
  type ExplainInput,
  type PromptTask,
  type Result,
} from "@openlinguo/core";
import { Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAiNotice } from "@/components/ai-notice";
import { AiSent } from "@/components/ai-sent";
import { Button } from "@/components/ui/button";
import { explainInput, saveExplanations, unexplained } from "@/data/ai-explain";
import type { AiCall } from "@/data/ai-notice";
import { loadAiConnection, rememberMode, type AiConnection } from "@/data/ai-settings";
import { database } from "@/data/database";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";
import type { UnknownWord } from "@/data/unknown-words";
import { languages } from "@/i18n/language";
import { AiFailure, type ShownError } from "@/shell/ai-settings";

type Outcome =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "answered"; readonly count: number }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly error: ShownError }
  | { readonly kind: "storage"; readonly reason: string };

/**
 * « Ask the AI » for the sequences it has not explained: one press, one call of at most
 * `EXPLAIN_MAX` sequences. A valid answer is kept as proposals and `onAnswered` lets the panel list
 * again; an invalid one is an error with « Try again », and nothing is kept.
 */
export const AiExplain = ({
  words,
  explanation,
  onAnswered,
}: {
  readonly words: readonly UnknownWord[];
  readonly explanation: PromptTask<ExplainInput, ExplainAnswer>;
  readonly onAnswered: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const notice = useAiNotice();
  const sentId = useId();
  const askButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const stop = useRef<AbortController | null>(null);
  const wasRunning = useRef(false);
  const [connection, setConnection] = useState<Result<
    AiConnection | null,
    ReviewLogFailure
  > | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const running = outcome.kind === "running";

  useEffect(() => {
    let current = true;
    void loadAiConnection(database).then((linked) => {
      if (current) setConnection(linked);
    });
    return () => {
      current = false;
      stop.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (running) cancelButton.current?.focus();
    else if (wasRunning.current) askButton.current?.focus();
    wasRunning.current = running;
  }, [running]);

  const ask = async (to: AiConnection, input: ExplainInput): Promise<void> => {
    const controller = new AbortController();
    stop.current = controller;
    setOutcome({ kind: "running" });
    const answer = await chat({
      endpoint: to.endpoint,
      model: to.model,
      messages: explanation.messages(input),
      schema: explanation.schema(input),
      mode: to.mode,
      signal: controller.signal,
    });
    if (stop.current !== controller) return;
    stop.current = null;
    if (!answer.ok) {
      const { error } = answer;
      const { kind } = error;
      setOutcome(
        kind === "aborted" ? { kind: "cancelled" } : { kind: "failed", error: { ...error, kind } },
      );
      return;
    }
    const createdAt = new Date().toISOString();
    const provenance: AiProvenance = {
      origin: "ai",
      provider: to.endpoint.provider,
      model: to.model,
      promptVersion: explanation.id,
      createdAt,
    };
    // Best effort: the remembered mode only saves a fallback request next time.
    await rememberMode(database, to, answer.value.mode);
    const saved = await saveExplanations(
      database,
      input,
      answer.value.value,
      provenance,
      Date.parse(createdAt),
    );
    setOutcome(
      saved.ok
        ? { kind: "answered", count: saved.value }
        : { kind: "storage", reason: describeFailure(saved.error) },
    );
    if (saved.ok) onAnswered();
  };

  if (connection === null) return null;
  if (!connection.ok)
    return (
      <p role="alert" className="mt-4 text-danger">
        {t("aiExplain.loadFailed", { reason: describeFailure(connection.error) })}
      </p>
    );
  const link = connection.value;
  if (link === null)
    return (
      <p className="mt-4 text-muted">
        {t("aiExplain.noProvider")}{" "}
        <Link to="/profile" hash="ai" className="underline underline-offset-3">
          {t("aiExplain.toSettings")}
        </Link>
      </p>
    );

  const pending = unexplained(words);
  const input = explainInput(
    pending,
    languages.find((language) => language === i18n.language) ?? "en",
  );
  const sent = input.sequences.length;
  const failed = outcome.kind === "failed" || outcome.kind === "storage";
  const action = failed ? t("aiExplain.retry") : t("aiExplain.ask");
  const call: AiCall = {
    provider: link.endpoint.provider,
    action,
    payload: { feature: "explanation", input },
  };
  const status = (): string => {
    switch (outcome.kind) {
      case "running":
        return t("aiExplain.asking");
      case "answered":
        return t("aiExplain.answered", { count: outcome.count });
      case "cancelled":
        return t("aiExplain.cancelled");
      case "idle":
      case "failed":
      case "storage":
        return "";
    }
  };

  return (
    <section className="mt-4">
      <p className="text-muted">{t("aiExplain.intro")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          ref={askButton}
          aria-describedby={sentId}
          aria-disabled={running || sent === 0}
          onClick={() => {
            if (!running && sent > 0) notice.ask(call.provider, () => void ask(link, input));
          }}
        >
          {running && (
            <LoaderCircle aria-hidden="true" className="size-4.5 motion-safe:animate-spin" />
          )}
          {running ? t("aiExplain.asking") : action}
        </Button>
        {running && (
          <Button
            ref={cancelButton}
            variant="outline"
            onClick={() => {
              stop.current?.abort();
            }}
          >
            {t("aiExplain.cancel")}
          </Button>
        )}
      </div>
      {sent === 0 ? (
        <p id={sentId} className="mt-2 text-small text-muted">
          {t("aiExplain.nothingToSend")}
        </p>
      ) : (
        <AiSent id={sentId} call={call} />
      )}
      {pending.length > sent && (
        <p className="mt-1 text-small text-muted">
          {t("aiExplain.more", { count: pending.length - sent })}
        </p>
      )}
      <p role="status" className="mt-3">
        {status()}
      </p>
      {outcome.kind === "failed" && (
        <AiFailure provider={link.endpoint.provider} error={outcome.error} />
      )}
      {outcome.kind === "storage" && (
        <p role="alert" className="mt-3 text-danger">
          {t("aiExplain.saveFailed", { reason: outcome.reason })}
        </p>
      )}
      {notice.view}
    </section>
  );
};
