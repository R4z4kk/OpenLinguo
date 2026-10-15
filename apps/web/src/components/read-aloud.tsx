import type { LanguagePack } from "@openlinguo/core";
import { Mic, Square } from "lucide-react";
import { useId, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { describeDownloadFailure } from "@/components/download-controls";
import { HeardText } from "@/components/heard-text";
import { SpeechModelControls, useSpeechModel, useTranscriber } from "@/components/speech-model";
import { Button } from "@/components/ui/button";
import { checkTranscript, readText, type SpeechCheck } from "@/data/transcript";
import { maxSeconds } from "@/lib/recording";
import type { RecognizerError } from "@/lib/speech-recognizer";
import { useRecording, type RecordingPhase } from "@/lib/use-recording";

/** Sentences longer than this are not checked: Whisper hears 30 s at a time. */
const MAX_CHARACTERS = 60;
const MAX_SECONDS = 30;

type Check =
  | { readonly kind: "none" }
  | { readonly kind: "working" }
  | { readonly kind: "done"; readonly result: SpeechCheck }
  | { readonly kind: "failed"; readonly message: string };

export const recognizerFailure = (t: TFunction, error: RecognizerError): string =>
  error.kind === "failed"
    ? t("hear.failed", { reason: error.message })
    : t(error.kind === "missing" ? "hear.missingModel" : "hear.unreliable");

export const recordingStatus = (
  t: TFunction,
  phase: RecordingPhase,
  listening: string,
): string | null => {
  switch (phase.kind) {
    case "idle":
      return null;
    case "opening":
      return t("speak.opening");
    case "recording":
      return listening;
    case "failed":
      return phase.error.kind === "interrupted"
        ? t("speak.interrupted")
        : phase.error.kind === "failed"
          ? t("speak.microphoneFailed", { reason: phase.error.message })
          : t(`speak.microphone.${phase.error.kind}`);
  }
};

/**
 * Type a sentence, read it aloud, see what speech recognition heard (Whisper, on the device, after
 * the learner downloads it). Optional: nothing else in the app needs a voice (EN 301 549 4.2.6).
 */
export const ReadAloud = ({ pack }: { readonly pack: LanguagePack }) => {
  const { t } = useTranslation();
  const headingId = useId();
  const textId = useId();
  const { model, refresh } = useSpeechModel();
  const transcribe = useTranscriber(model);
  const [text, setText] = useState("");
  const [check, setCheck] = useState<Check>({ kind: "none" });
  const characters = Array.from(text.matchAll(/\p{Script=Han}/gu)).length;

  const run = async (samples: Float32Array, sampleRate: number): Promise<void> => {
    setCheck({ kind: "working" });
    const expected = await readText(pack, text);
    if (!expected.ok) {
      setCheck({ kind: "failed", message: t("hear.failed", { reason: expected.error.kind }) });
      return;
    }
    const heard = await transcribe(samples, sampleRate, expected.value.length);
    if (!heard.ok) {
      setCheck({ kind: "failed", message: recognizerFailure(t, heard.error) });
      if (heard.error.kind !== "failed") refresh();
      return;
    }
    const result = await checkTranscript(pack, expected.value, heard.value);
    setCheck(
      result.ok
        ? { kind: "done", result: result.value }
        : { kind: "failed", message: t("hear.failed", { reason: result.error.kind }) },
    );
  };
  const recording = useRecording(
    Math.min(MAX_SECONDS, maxSeconds(characters)),
    (samples, sampleRate) => {
      void run(samples, sampleRate);
    },
  );

  const installed = model.status === "ready" && model.state === "installed";
  const problem =
    characters === 0
      ? t("readAloud.noText")
      : characters > MAX_CHARACTERS
        ? t("readAloud.tooLong", { max: MAX_CHARACTERS })
        : null;
  const status =
    recordingStatus(t, recording.phase, t("readAloud.recording")) ??
    (check.kind === "working"
      ? t("readAloud.working")
      : check.kind === "failed"
        ? check.message
        : null);

  return (
    <section aria-labelledby={headingId} className="mt-6 flex flex-col items-start gap-3">
      <h2 id={headingId} className="text-subtitle">
        {t("readAloud.title")}
      </h2>
      <p>{t("readAloud.intro")}</p>
      <p className="text-small">{t("readAloud.notice")}</p>
      {model.status === "unavailable" && (
        <p role="alert" className="text-danger">
          {model.failure === null
            ? t("readAloud.unsupported")
            : model.failure.kind === "cancelled"
              ? null
              : t("readAloud.unavailable", { reason: describeDownloadFailure(t, model.failure) })}
        </p>
      )}
      {model.status === "ready" && model.webgpuSetAside && model.state !== "installed" && (
        <p>{t("hear.unreliable")}</p>
      )}
      {model.status === "ready" && (
        <SpeechModelControls
          index={model.index}
          backend={model.backend}
          state={model.state}
          describedBy={headingId}
          onChange={refresh}
        />
      )}
      {installed && (
        <>
          <div className="w-full max-w-xl">
            <label htmlFor={textId} className="font-semibold">
              {t("readAloud.sentence")}
            </label>
            <textarea
              id={textId}
              lang="zh-Hans"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setCheck({ kind: "none" });
              }}
              rows={2}
              className="mt-2 w-full rounded-control border border-border-strong bg-surface px-3 py-2 font-zh text-body"
            />
          </div>
          {recording.phase.kind === "recording" ? (
            <Button variant="outline" onClick={recording.stop}>
              <Square aria-hidden="true" className="size-4" />
              {t("speak.stop")}
            </Button>
          ) : (
            <Button
              variant="outline"
              aria-disabled={
                problem !== null || recording.phase.kind === "opening" || check.kind === "working"
              }
              {...(problem === null ? {} : { "aria-describedby": `${textId}-problem` })}
              onClick={() => {
                if (problem === null && check.kind !== "working") void recording.start();
              }}
            >
              <Mic aria-hidden="true" className="size-4" />
              {t(check.kind === "done" ? "speak.again" : "speak.record")}
            </Button>
          )}
          {problem !== null && (
            <p id={`${textId}-problem`} className="text-small text-muted">
              {problem}
            </p>
          )}
        </>
      )}
      <div role="status" className="flex flex-col gap-1">
        {status !== null && (
          <p
            className={
              check.kind === "failed" || recording.phase.kind === "failed" ? "text-danger" : ""
            }
          >
            {status}
          </p>
        )}
        {check.kind === "done" && (
          <>
            <HeardText
              expected={check.result.expected}
              heard={check.result.heard}
              features={pack.features}
            />
            <p className="text-small text-muted">{t("hear.tones")}</p>
          </>
        )}
      </div>
    </section>
  );
};
