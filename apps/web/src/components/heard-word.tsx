import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HeardText } from "@/components/heard-text";
import type { PinyinFeatures } from "@/components/pinyin";
import { recognizerFailure } from "@/components/read-aloud";
import { useSpeechModel, useTranscriber } from "@/components/speech-model";
import { useData } from "@/data/data-context";
import { checkTranscript, readWord, type SpeechCheck } from "@/data/transcript";

export type Said = { readonly samples: Float32Array; readonly sampleRate: number };

type Hint =
  | { readonly kind: "none" }
  | { readonly kind: "working" }
  | { readonly kind: "done"; readonly result: SpeechCheck }
  | { readonly kind: "failed"; readonly message: string };

/**
 * What speech recognition heard when the word was said, once the learner downloaded it (Read page).
 * A hint only: Whisper often mishears a word said alone (ADR 0007), the tone result above is the check.
 */
export const HeardWord = ({
  headword,
  readingKey,
  features,
  said,
}: {
  readonly headword: string;
  readonly readingKey: string;
  readonly features: PinyinFeatures;
  readonly said: Said | null;
}) => {
  const { t } = useTranslation();
  const { state } = useData();
  const { model, refresh } = useSpeechModel();
  const transcribe = useTranscriber(model);
  /** The hint of the recording it was computed for: a new recording shows "working" until its own. */
  const [hint, setHint] = useState<{ readonly said: Said; readonly hint: Hint } | null>(null);
  const installed = model.status === "ready" && model.state === "installed";
  const pack = state.status === "ready" ? state.pack : null;
  const expected = readWord(headword, readingKey);
  const shown: Hint =
    said === null || !installed || pack === null || expected === null
      ? { kind: "none" }
      : hint?.said === said
        ? hint.hint
        : { kind: "working" };

  useEffect(() => {
    const words = readWord(headword, readingKey);
    if (said === null || !installed || pack === null || words === null) return;
    const replaced = new AbortController();
    const check = async (): Promise<Hint> => {
      const heard = await transcribe(said.samples, said.sampleRate, words.length);
      if (!heard.ok) {
        if (heard.error.kind === "missing") refresh();
        return { kind: "failed", message: recognizerFailure(t, heard.error) };
      }
      const result = await checkTranscript(pack, words, heard.value);
      return result.ok
        ? { kind: "done", result: result.value }
        : { kind: "failed", message: t("hear.failed", { reason: result.error.kind }) };
    };
    void check().then((computed) => {
      if (!replaced.signal.aborted) setHint({ said, hint: computed });
    });
    return () => {
      replaced.abort();
    };
  }, [said, installed, pack, headword, readingKey, transcribe, refresh, t]);

  if (model.status !== "ready") return null;
  if (!installed) {
    return (
      <p className="text-small text-muted">
        {t("hear.offer")} <Link to="/read">{t("hear.offerLink")}</Link>
      </p>
    );
  }
  return (
    <div role="status" className="flex flex-col gap-1">
      {shown.kind === "working" && <p>{t("readAloud.working")}</p>}
      {shown.kind === "failed" && <p className="text-danger">{shown.message}</p>}
      {shown.kind === "done" && (
        <>
          <HeardText
            expected={shown.result.expected}
            heard={shown.result.heard}
            features={features}
          />
          <p className="text-small text-muted">{t("hear.indicative")}</p>
        </>
      )}
    </div>
  );
};
