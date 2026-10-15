import {
  contour,
  err,
  ok,
  scorePronunciation,
  type Contour,
  type Gloss,
  type Result,
  type SyllableScore,
} from "@openlinguo/core";
import { Headphones, Mic, Save, Square, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { HeardWord, type Said } from "@/components/heard-word";
import { PitchChart } from "@/components/pitch-chart";
import { Pinyin, type PinyinFeatures } from "@/components/pinyin";
import { ToneCard } from "@/components/tone-card";
import { Button } from "@/components/ui/button";
import { database, type StoredRecording } from "@/data/database";
import { browserStorage, requestPersistence } from "@/data/persistence";
import { referenceContour, type ReferenceError } from "@/data/pronunciation";
import { deleteRecording, fromPcm16, keepRecording, keptRecording } from "@/data/recordings";
import { describeFailure, guarded, type ReviewLogFailure } from "@/data/review-log";
import { spokenReading, toneLabel, toneSyllables } from "@/data/tone-card";
import type { Language } from "@/i18n/language";
import { openMicrophone, type Microphone, type MicrophoneError } from "@/lib/microphone";
import { playInTurn, type Clip } from "@/lib/playback";
import { useReducedMotion } from "@/lib/reduced-motion";
import { joinSamples, maxSeconds, speechEnded } from "@/lib/recording";
import { resample, SAMPLE_RATE } from "@/lib/speech-recognizer";

const PINYIN = "zh-Latn-pinyin";
const TICK_MS = 100;

/** The voice played after the model: the recording just made, or the one kept. */
type Voice = "said" | "kept";

type Notice = { readonly text: string; readonly failed: boolean };

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
 * speech recognition heard once downloaded; replay the model then your voice (shadowing). The voice
 * stays in memory on the device until the next recording, unless kept: one kept recording per
 * reading, on the device only. The microphone is open only while recording. R and A work only while
 * focus is in the section (WCAG 2.1.4). A listening mode is always offered (EN 301 549 4.2.6).
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
  const [kept, setKept] = useState<Result<StoredRecording | null, ReviewLogFailure> | null>(null);
  /** The recording just made, once kept: Keep is not offered twice. */
  const [keptSaid, setKeptSaid] = useState<Said | null>(null);
  const [playing, setPlaying] = useState<Voice | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const recording = useRef<Recording | null>(null);
  const playback = useRef<AbortController | null>(null);
  const opening = useRef(false);
  const mounted = useRef(true);
  const toneCard = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
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

  useEffect(() => {
    let current = true;
    void keptRecording(database, audioId).then((result) => {
      if (current) setKept(result);
    });
    return () => {
      current = false;
    };
  }, [audioId]);

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
      playback.current?.abort();
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
    // The model played aloud would be recorded too.
    playback.current?.abort();
    setPhase({ kind: "opening" });
    setVoice(null);
    setSaid(null);
    setNotice(null);
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

  const keptValue = kept?.ok === true ? kept.value : null;

  /** Plays the model then the voice; pressed again while playing, stops. */
  const compare = async (which: Voice): Promise<void> => {
    if (playback.current !== null) {
      playback.current.abort();
      return;
    }
    const voiceClip: Clip | null =
      which === "said"
        ? said === null
          ? null
          : { kind: "samples", ...said }
        : keptValue === null
          ? null
          : {
              kind: "samples",
              samples: fromPcm16(keptValue.data),
              sampleRate: keptValue.sampleRate,
            };
    if (voiceClip === null) return;
    const controller = new AbortController();
    playback.current = controller;
    setPlaying(which);
    const played = await playInTurn(async () => {
      const model = await guarded(async () => ok((await database.wordAudio.get(audioId)) ?? null));
      if (!model.ok) return err(describeFailure(model.error));
      if (model.value === null) return err(t("audio.gone"));
      return ok([{ kind: "encoded", data: model.value.data }, voiceClip]);
    }, controller.signal);
    playback.current = null;
    if (!mounted.current) return;
    setPlaying(null);
    if (!played.ok) {
      setNotice({ text: t("review.audioFailed", { reason: played.error }), failed: true });
    }
  };

  const keep = async (): Promise<void> => {
    if (said === null) return;
    let samples: Float32Array;
    try {
      samples = await resample(said.samples, said.sampleRate);
    } catch (error) {
      setNotice({ text: t("speak.keepFailed", { reason: String(error) }), failed: true });
      return;
    }
    await requestPersistence(browserStorage());
    const stored = await keepRecording(database, {
      headword,
      readingKey,
      recordedAt: Date.now(),
      sampleRate: SAMPLE_RATE,
      samples,
    });
    if (!mounted.current) return;
    if (!stored.ok) {
      setNotice({
        text: t("speak.keepFailed", { reason: describeFailure(stored.error) }),
        failed: true,
      });
      return;
    }
    setKeptSaid(said);
    setNotice({ text: t("speak.keptNotice"), failed: false });
    setKept(await keptRecording(database, audioId));
  };

  const removeKept = async (): Promise<void> => {
    playback.current?.abort();
    const removed = await deleteRecording(database, audioId);
    if (!mounted.current) return;
    if (!removed.ok) {
      setNotice({
        text: t("speak.deleteFailed", { reason: describeFailure(removed.error) }),
        failed: true,
      });
      return;
    }
    setKeptSaid(null);
    setKept(ok(null));
    setNotice({ text: t("speak.keptDeleted"), failed: false });
    heading.current?.focus();
  };

  /** The voice A plays: the recording just made, else the kept one. */
  const shortcutVoice: Voice | null = said !== null ? "said" : keptValue !== null ? "kept" : null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === "r") {
      event.preventDefault();
      if (phase.kind === "recording") stop();
      else void record();
    } else if (key === "a" && shortcutVoice !== null) {
      event.preventDefault();
      void compare(shortcutVoice);
    }
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

  const compareButton = (which: Voice) => (
    <Button
      variant="outline"
      {...(shortcutVoice === which ? { "aria-keyshortcuts": "A" } : {})}
      onClick={() => void compare(which)}
    >
      {playing === which ? (
        <Square aria-hidden="true" className="size-4" />
      ) : (
        <Headphones aria-hidden="true" className="size-4" />
      )}
      {t(playing === which ? "speak.stopPlaying" : `speak.compare.${which}`)}
    </Button>
  );

  const dateTime = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });

  return (
    <section aria-labelledby={headingId} className="mt-4 flex flex-col items-start gap-3">
      <Heading id={headingId} ref={heading} tabIndex={-1} className="text-small text-muted">
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
        // eslint-disable-next-line jsx-a11y-x/no-static-element-interactions -- Shortcuts bubble from the buttons inside, so they only work while focus is there (WCAG 2.1.4).
        <div className="flex w-full flex-col items-start gap-3" onKeyDown={onKeyDown}>
          <PitchChart reference={reference.value} voice={voice} labels={labels} />
          <div className="flex flex-wrap gap-2">
            {phase.kind === "recording" ? (
              <Button variant="outline" aria-keyshortcuts="R" onClick={stop}>
                <Square aria-hidden="true" className="size-4" />
                {t("speak.stop")}
              </Button>
            ) : (
              <Button
                variant="outline"
                aria-keyshortcuts="R"
                aria-disabled={phase.kind === "opening"}
                onClick={() => void record()}
              >
                <Mic aria-hidden="true" className="size-4" />
                {t(phase.kind === "scored" ? "speak.again" : "speak.record")}
              </Button>
            )}
            {said !== null && compareButton("said")}
            {said !== null && keptSaid !== said && (
              <Button variant="outline" onClick={() => void keep()}>
                <Save aria-hidden="true" className="size-4" />
                {t("speak.keep")}
              </Button>
            )}
          </div>
          {keptValue !== null && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-small">
                {t("speak.kept", { date: dateTime.format(keptValue.recordedAt) })}
              </p>
              <div className="flex flex-wrap gap-2">
                {compareButton("kept")}
                <Button variant="ghost" onClick={() => void removeKept()}>
                  <Trash2 aria-hidden="true" className="size-4" />
                  {t("speak.deleteKept")}
                </Button>
              </div>
            </div>
          )}
          <p className="text-small text-muted">{t("speak.keys")}</p>
        </div>
      )}
      {kept !== null && !kept.ok && (
        <p role="alert" className="text-danger">
          {t("speak.keptFailed", { reason: describeFailure(kept.error) })}
        </p>
      )}
      <div role="status" className="flex flex-col gap-1">
        {status !== null && (
          <p className={phase.kind === "failed" ? "text-danger" : ""}>{status}</p>
        )}
        {notice !== null && <p className={notice.failed ? "text-danger" : ""}>{notice.text}</p>}
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
