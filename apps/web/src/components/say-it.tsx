import {
  contour,
  scorePronunciation,
  type Contour,
  type Gloss,
  type Result,
  type SyllableScore,
} from "@openlinguo/core";
import { Mic, Square } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HeardWord, type Said } from "@/components/heard-word";
import { PitchChart } from "@/components/pitch-chart";
import { Pinyin, type PinyinFeatures } from "@/components/pinyin";
import { ToneCard } from "@/components/tone-card";
import { Button } from "@/components/ui/button";
import { referenceContour, type ReferenceError } from "@/data/pronunciation";
import { spokenReading, toneLabel, toneSyllables } from "@/data/tone-card";
import type { Language } from "@/i18n/language";
import { openMicrophone, type Microphone, type MicrophoneError } from "@/lib/microphone";
import { useReducedMotion } from "@/lib/reduced-motion";
import { joinSamples, maxSeconds, speechEnded } from "@/lib/recording";

const PINYIN = "zh-Latn-pinyin";
const TICK_MS = 100;

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "opening" }
  | { readonly kind: "recording" }
  | { readonly kind: "scored"; readonly scores: readonly SyllableScore[] }
  | { readonly kind: "failed"; readonly message: string };

type Recording = {
  readonly microphone: Microphone;
  readonly blocks: Float32Array[];
  readonly timer: number;
};

type Props = {
  readonly headword: string;
  readonly readingKey: string;
  /** The pack recording, `wordAudio` id. */
  readonly audioId: string;
  readonly glosses: readonly Gloss[];
  readonly features: PinyinFeatures;
  readonly language: Language;
  readonly heading: "h2" | "h3";
};

/**
 * Say the word, see your pitch over the reference recording's, get a result per syllable, and what
 * speech recognition heard once downloaded. The voice stays in memory on the device until the next
 * recording; the microphone is open only while recording. A listening mode is always offered (EN 301 549 4.2.6).
 */
export const SayIt = ({
  headword,
  readingKey,
  audioId,
  glosses,
  features,
  language,
  heading: Heading,
}: Props) => {
  const { t } = useTranslation();
  const syllables = toneSyllables(readingKey);
  const spoken = spokenReading(headword, readingKey);
  const count = syllables?.length ?? 0;
  const reducedMotion = useReducedMotion();
  const [reference, setReference] = useState<Result<Contour, ReferenceError> | null>(null);
  const [voice, setVoice] = useState<Contour | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [listening, setListening] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  const recording = useRef<Recording | null>(null);
  const opening = useRef(false);
  const mounted = useRef(true);
  const toneCard = useRef<HTMLDivElement>(null);
  const headingId = useId();

  useEffect(() => {
    if (count === 0) return;
    let current = true;
    void referenceContour(audioId, count).then((result) => {
      if (current) setReference(result);
    });
    return () => {
      current = false;
    };
  }, [audioId, count]);

  /** Releases the microphone and hands back what was recorded. */
  const close = (): Float32Array | null => {
    const active = recording.current;
    if (active === null) return null;
    recording.current = null;
    window.clearInterval(active.timer);
    active.microphone.release();
    return joinSamples(active.blocks.splice(0));
  };

  useEffect(() => {
    mounted.current = true;
    const onHidden = (): void => {
      if (document.visibilityState === "hidden" && close() !== null) {
        setVoice(null);
        setPhase({ kind: "failed", message: t("speak.interrupted") });
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onHidden);
      close();
    };
  }, [t]);

  if (syllables === null || spoken === null) return null;

  const tone = (value: number): string => toneLabel(value, t("review.toneNeutral"));
  const characters = Array.from(headword);
  const labels = syllables.map(({ letters }, index) => (
    <>
      {characters.length === syllables.length && <span lang="zh-Hans">{characters[index]} </span>}
      <span lang={PINYIN}>{letters}</span>
    </>
  ));
  const decimal = new Intl.NumberFormat(language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const microphoneFailure = (error: MicrophoneError): string =>
    error.kind === "failed"
      ? t("speak.microphoneFailed", { reason: error.message })
      : t(`speak.microphone.${error.kind}`);

  const finish = (samples: Float32Array, sampleRate: number): void => {
    if (reference === null || !reference.ok) return;
    const heard = contour(samples, sampleRate, count);
    if (!heard.ok) {
      setVoice(null);
      setPhase({ kind: "failed", message: t("speak.nothingHeard") });
      return;
    }
    const scores = scorePronunciation(heard.value, reference.value, spoken.tones);
    if (!scores.ok) {
      setPhase({ kind: "failed", message: t("speak.scoreFailed", { reason: scores.error.kind }) });
      return;
    }
    setVoice(heard.value);
    setPhase({ kind: "scored", scores: scores.value });
    setSaid({ samples, sampleRate });
  };

  const record = async (): Promise<void> => {
    if (recording.current !== null || opening.current) return;
    opening.current = true;
    setPhase({ kind: "opening" });
    setVoice(null);
    setSaid(null);
    const blocks: Float32Array[] = [];
    const opened = await openMicrophone((block) => {
      blocks.push(block);
    });
    opening.current = false;
    if (opened.ok && !mounted.current) {
      opened.value.release();
      return;
    }
    if (!opened.ok) {
      setPhase({ kind: "failed", message: microphoneFailure(opened.error) });
      return;
    }
    const { sampleRate } = opened.value;
    const timer = window.setInterval(() => {
      const samples = joinSamples(blocks);
      const live = contour(samples, sampleRate, count);
      if (live.ok && !reducedMotion) setVoice(live.value);
      const late = samples.length >= maxSeconds(count) * sampleRate;
      if ((live.ok && speechEnded(samples, sampleRate)) || late) {
        const all = close();
        if (all !== null) finish(all, sampleRate);
      }
    }, TICK_MS);
    recording.current = { microphone: opened.value, blocks, timer };
    setPhase({ kind: "recording" });
  };

  const stop = (): void => {
    const sampleRate = recording.current?.microphone.sampleRate ?? null;
    const samples = close();
    if (samples !== null && sampleRate !== null) finish(samples, sampleRate);
  };

  const result = (score: SyllableScore, index: number): string => {
    const expected = tone(spoken.tones[index] ?? 0);
    const { verdict } = score;
    const heard =
      verdict.kind === "right"
        ? t("speak.right", { tone: expected })
        : verdict.kind === "other"
          ? t("speak.other", { tone: tone(verdict.tone), expected })
          : t(`speak.${verdict.kind}`, { expected });
    return score.distance === null
      ? heard
      : `${heard}; ${t("speak.distance", { distance: decimal.format(score.distance) })}`;
  };

  const status =
    phase.kind === "opening"
      ? t("speak.opening")
      : phase.kind === "recording"
        ? t("speak.recording")
        : phase.kind === "failed"
          ? phase.message
          : null;

  return (
    <section aria-labelledby={headingId} className="mt-4 flex flex-col items-start gap-3">
      <Heading id={headingId} className="text-small text-muted">
        {t("speak.title")}
      </Heading>
      <p className="text-small">{t("speak.notice")}</p>
      {spoken.reading !== readingKey && (
        <p>
          {t("review.toneSaid")}{" "}
          <Pinyin reading={spoken.reading} features={features} className="text-subtitle" />
        </p>
      )}
      {reference !== null && !reference.ok && (
        <p role="alert" className="text-danger">
          {t("speak.referenceFailed", {
            reason: "message" in reference.error ? reference.error.message : reference.error.kind,
          })}
        </p>
      )}
      {reference?.ok === true && (
        <>
          <PitchChart reference={reference.value} voice={voice} labels={labels} />
          {phase.kind === "recording" ? (
            <Button variant="outline" onClick={stop}>
              <Square aria-hidden="true" className="size-4" />
              {t("speak.stop")}
            </Button>
          ) : (
            <Button
              variant="outline"
              aria-disabled={phase.kind === "opening"}
              onClick={() => void record()}
            >
              <Mic aria-hidden="true" className="size-4" />
              {t(phase.kind === "scored" ? "speak.again" : "speak.record")}
            </Button>
          )}
        </>
      )}
      <div role="status" className="flex flex-col gap-1">
        {status !== null && (
          <p className={phase.kind === "failed" ? "text-danger" : ""}>{status}</p>
        )}
        {phase.kind === "scored" && (
          <ul className="flex flex-col gap-1">
            {phase.scores.map((score, index) => (
              <li key={index}>
                <span lang={PINYIN}>{syllables[index]?.letters}</span>: {result(score, index)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <HeardWord headword={headword} readingKey={readingKey} features={features} said={said} />
      <Button
        variant="ghost"
        aria-expanded={listening}
        onClick={() => {
          setListening(!listening);
        }}
      >
        {t("speak.listenInstead")}
      </Button>
      {listening && (
        <div className="w-full rounded-card border border-hairline p-4">
          <ToneCard
            headword={headword}
            readingKey={readingKey}
            glosses={glosses}
            audio={{ table: "wordAudio", id: audioId }}
            features={features}
            language={language}
            focusTarget={toneCard}
            onGrade={null}
            onContinue={() => {
              setListening(false);
            }}
          />
        </div>
      )}
    </section>
  );
};
