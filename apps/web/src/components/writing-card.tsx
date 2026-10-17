import {
  err,
  gradeWriting,
  HINT_AFTER_MISSES,
  showsHint,
  startWritingQuiz,
  type Gloss,
  type Grade,
  type LanguageFeatures,
  type Result,
  type StrokeData,
  type StrokePoint,
  type WritingFinished,
  type WritingInProgress,
  type WritingQuiz,
  type WritingQuizError,
} from "@openlinguo/core";
import { Check, Lightbulb, X } from "lucide-react";
import {
  Suspense,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { GlossSummary } from "@/components/gloss-summary";
import { Pinyin, type PinyinFeatures } from "@/components/pinyin";
import { PlayAudio } from "@/components/play-audio";
import { GridLines, StrokeOrder } from "@/components/stroke-order";
import { Switch } from "@/components/switch";
import { Button } from "@/components/ui/button";
import type { AudioSource } from "@/data/audio-packs";
import { saveSetting } from "@/data/daily-goal";
import { WRITE_ON_PAPER } from "@/data/practice";
import {
  characterReports,
  hinted,
  judgeStroke,
  strokePoint,
  wordStrokes,
  type StrokeFeedback,
  type WordStrokesError,
} from "@/data/writing-card";
import type { Language } from "@/i18n/language";
import { cn } from "@/lib/utils";

/** The stroke data's y axis points up from its baseline (see `StrokePoint`). */
const FLIP = "translate(0 900) scale(1 -1)";
const storage = (): Storage => localStorage;

/** About 6 px on the phone's grid. */
const TRACE_WIDTH = 24;

const FEEDBACK_ICONS = {
  right: Check,
  miss: X,
  backwards: X,
  hint: Lightbulb,
  revealed: Lightbulb,
} as const;

type WordStrokes = Promise<Result<readonly StrokeData[], WordStrokesError>>;

type Props = {
  readonly headword: string;
  readonly readingKey: string;
  readonly glosses: readonly Gloss[];
  readonly audio: AudioSource | null;
  readonly features: PinyinFeatures & Pick<LanguageFeatures, "strokes">;
  readonly language: Language;
  readonly focusTarget: RefObject<HTMLDivElement | null>;
  /** The "Write on paper" setting. */
  readonly paperChecked: boolean;
  /** Written on paper, the stroke order shown on request and graded by the caller, or drawn. */
  readonly paper: boolean;
  /** Paper mode: the stroke order is shown. */
  readonly revealed: boolean;
  readonly onPaperChange: (paper: boolean) => void;
  /** Drawn: stores the grade; `false` when it could not be stored (the failure is shown by the caller). */
  readonly onGrade: (grade: Grade) => Promise<boolean>;
  readonly onContinue: () => void;
};

const reasonOf = (error: WordStrokesError | WritingQuizError): string => {
  switch (error.kind) {
    case "storage-failure":
      return error.message;
    case "dataset-missing":
      return error.dataset;
    case "no-strokes":
      return error.character;
    default:
      return error.kind;
  }
};

/** A character's first `count` strokes; those drawn after a hint are muted. */
const Strokes = ({
  data,
  misses,
  count,
}: {
  readonly data: StrokeData;
  readonly misses: readonly number[];
  readonly count: number;
}) =>
  data.strokes.slice(0, count).map((stroke, index) => (
    // Strokes never move: the index is a stable key.
    <path
      key={index}
      d={stroke}
      className={hinted(misses[index] ?? 0) ? "fill-muted" : "fill-ink"}
    />
  ));

const Feedback = ({ feedback: { kind, stroke } }: { readonly feedback: StrokeFeedback }) => {
  const { t } = useTranslation();
  const Icon = FEEDBACK_ICONS[kind];
  return (
    <>
      <Icon aria-hidden="true" className="size-5 flex-none" />
      <span>{t(`review.writingStroke.${kind}`, { stroke, misses: HINT_AFTER_MISSES })}</span>
    </>
  );
};

const Outcome = ({
  quiz,
  characters,
  stored,
  busy,
  onSave,
  onContinue,
}: {
  readonly quiz: WritingFinished;
  readonly characters: readonly string[];
  readonly stored: boolean | null;
  readonly busy: boolean;
  readonly onSave: () => void;
  readonly onContinue: () => void;
}) => {
  const { t } = useTranslation();
  const next = useRef<HTMLButtonElement>(null);
  const reports = characterReports(quiz);

  useEffect(() => {
    if (stored !== null) next.current?.focus();
  }, [stored]);

  return (
    <>
      <div className="flex flex-wrap justify-center gap-4">
        {quiz.characters.map((data, index) => {
          const character = characters[index] ?? "";
          const { misses, hinted: hints } = reports[index] ?? { misses: 0, hinted: [] };
          const report = [
            misses === 0 ? t("review.writingClean") : t("review.writingMisses", { count: misses }),
            ...(hints.length === 0
              ? []
              : [t("review.writingHinted", { count: hints.length, strokes: hints.join(", ") })]),
          ].join(", ");
          return (
            // Characters never move: the index is a stable key.
            <figure key={index} className="flex flex-col items-center gap-2">
              <svg
                viewBox="0 0 1024 1024"
                role="img"
                aria-label={t("review.writingYours", { character })}
                className="size-30 rounded-card border border-hairline bg-surface"
              >
                <GridLines />
                <g transform={FLIP}>
                  <Strokes
                    data={data}
                    misses={quiz.misses[index] ?? []}
                    count={data.strokes.length}
                  />
                </g>
              </svg>
              <figcaption className="max-w-36 text-small text-muted">
                <span lang="zh-Hans">{character}</span>
                {t("review.writingReport", { report })}
              </figcaption>
            </figure>
          );
        })}
      </div>
      <div role="status" className="flex flex-col items-center gap-1">
        <p className="font-semibold">
          {t("review.toneGraded", { grade: t(`review.grades.${gradeWriting(quiz)}`) })}
        </p>
        <p className="text-small text-muted">{t("review.writingRule")}</p>
      </div>
      <Button
        ref={next}
        className="w-full"
        aria-disabled={busy || stored === null}
        onClick={() => {
          if (busy) return;
          if (stored === true) onContinue();
          else if (stored === false) onSave();
        }}
      >
        {t(stored === false ? "review.writingSaveAgain" : "review.toneContinue")}
      </Button>
    </>
  );
};

/**
 * The 米 grid without outline: each stroke is drawn with a pointer (mouse, touch or pen) and judged
 * on release, a cancelled one dropped (SC 2.5.2). Graded from the misses when the word is drawn.
 */
const Quiz = ({
  start,
  characters,
  prompt,
  onGrade,
  onContinue,
}: {
  readonly start: WritingQuiz;
  readonly characters: readonly string[];
  readonly prompt: ReactNode;
  readonly onGrade: (grade: Grade) => Promise<boolean>;
  readonly onContinue: () => void;
}) => {
  const { t } = useTranslation();
  const [quiz, setQuiz] = useState(start);
  const [trace, setTrace] = useState<readonly StrokePoint[]>([]);
  /** `attempt` renders each feedback anew, so a repeated one is announced again. */
  const [said, setSaid] = useState<{
    readonly feedback: StrokeFeedback;
    readonly attempt: number;
  } | null>(null);
  const [stored, setStored] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const pointer = useRef<number | null>(null);
  const drawn = useRef<readonly StrokePoint[]>([]);

  const store = async (finished: WritingFinished): Promise<void> => {
    setBusy(true);
    setStored(await onGrade(gradeWriting(finished)));
    setBusy(false);
  };

  const judge = (current: WritingInProgress, points: readonly StrokePoint[]): void => {
    const judged = judgeStroke(current, points);
    if (!judged.ok) {
      setFailure(reasonOf(judged.error));
      return;
    }
    const { quiz: next, feedback } = judged.value;
    if (feedback === null) return;
    setQuiz(next);
    setSaid({ feedback, attempt: (said?.attempt ?? 0) + 1 });
    if (next.finished) void store(next);
  };

  if (quiz.finished)
    return (
      <>
        {prompt}
        <Outcome
          quiz={quiz}
          characters={characters}
          stored={stored}
          busy={busy}
          onSave={() => void store(quiz)}
          onContinue={onContinue}
        />
      </>
    );

  const data = quiz.characters[quiz.character] ?? null;
  if (data === null) return null;
  const misses = quiz.misses[quiz.character] ?? [];
  const hint = showsHint(quiz);
  const hintStart = data.medians[quiz.stroke]?.[0] ?? null;
  const position = { current: quiz.character + 1, total: characters.length };

  const pointOf = (event: PointerEvent<SVGSVGElement>): StrokePoint =>
    strokePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());

  const end = (event: PointerEvent<SVGSVGElement>, judged: boolean): void => {
    if (event.pointerId !== pointer.current) return;
    pointer.current = null;
    setTrace([]);
    if (judged) judge(quiz, drawn.current);
  };

  return (
    <>
      <p className="text-small text-muted">{t("review.writingDraw")}</p>
      {prompt}
      <div className="flex items-center gap-3">
        <span className="text-small text-muted">{t("review.writingCharacter", position)}</span>
        <span aria-hidden="true" className="flex gap-1.5">
          {characters.map((character, index) => (
            // Characters never move: the index is a stable key.
            <span
              key={index}
              className={cn(
                "flex size-8 items-center justify-center rounded-control",
                index < quiz.character
                  ? "border border-hairline"
                  : index === quiz.character
                    ? "border-2 border-ink"
                    : "border border-dashed border-border-strong",
              )}
            >
              {index < quiz.character && (
                <span lang="zh-Hans" className="font-display text-subtitle font-normal">
                  {character}
                </span>
              )}
            </span>
          ))}
        </span>
      </div>
      <div
        role="img"
        aria-label={t(hint ? "review.writingGridHint" : "review.writingGrid", position)}
        className="w-full max-w-70 overflow-hidden rounded-card border border-border-strong bg-surface lg:max-w-80"
      >
        <svg
          viewBox="0 0 1024 1024"
          aria-hidden="true"
          className="block aspect-square w-full touch-none select-none"
          onPointerDown={(event) => {
            if (pointer.current !== null || !event.isPrimary || event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            pointer.current = event.pointerId;
            drawn.current = [pointOf(event)];
            setTrace(drawn.current);
          }}
          onPointerMove={(event) => {
            if (event.pointerId !== pointer.current) return;
            drawn.current = [...drawn.current, pointOf(event)];
            setTrace(drawn.current);
          }}
          onPointerUp={(event) => {
            end(event, true);
          }}
          onPointerCancel={(event) => {
            end(event, false);
          }}
        >
          <GridLines />
          <g transform={FLIP}>
            {hint && hintStart !== null && (
              <g key={quiz.stroke} className="motion-safe:animate-appear">
                <path
                  d={data.strokes[quiz.stroke] ?? ""}
                  className="fill-sunken stroke-border-strong"
                  strokeWidth={12}
                  strokeDasharray="28 18"
                  strokeLinejoin="round"
                />
                <circle cx={hintStart[0]} cy={hintStart[1]} r={34} className="fill-ink" />
              </g>
            )}
            <Strokes data={data} misses={misses} count={quiz.stroke} />
            {trace.length > 0 && (
              <polyline
                points={trace.map(([x, y]) => `${String(x)},${String(y)}`).join(" ")}
                fill="none"
                className="stroke-ink"
                strokeWidth={TRACE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </g>
        </svg>
      </div>
      <p role="status" className="flex min-h-6 items-center justify-center gap-2">
        {said !== null && <Feedback key={said.attempt} feedback={said.feedback} />}
      </p>
      {failure !== null && (
        <p role="alert" className="text-danger">
          {t("review.writingFailed", { reason: failure })}
        </p>
      )}
    </>
  );
};

const Drawing = ({
  strokes,
  ...props
}: { readonly strokes: WordStrokes } & Omit<Parameters<typeof Quiz>[0], "start">) => {
  const { t } = useTranslation();
  const loaded = use(strokes);
  const started = loaded.ok ? startWritingQuiz(loaded.value) : loaded;
  if (!started.ok)
    return (
      <p role="alert" className="text-danger">
        {t("review.writingFailed", { reason: reasonOf(started.error) })}
      </p>
    );
  return <Quiz start={started.value} {...props} />;
};

/** Paper mode: empty 米 boxes to count the characters, then each one's stroke order. */
const Paper = ({
  strokes,
  revealed,
  characters,
  prompt,
}: {
  readonly strokes: WordStrokes;
  readonly revealed: boolean;
  readonly characters: readonly string[];
  readonly prompt: ReactNode;
}) => {
  const { t } = useTranslation();
  // Read on arrival, so revealing does not suspend.
  const loaded = use(strokes);
  if (!loaded.ok)
    return (
      <p role="alert" className="text-danger">
        {t("review.writingFailed", { reason: reasonOf(loaded.error) })}
      </p>
    );
  if (!revealed)
    return (
      <>
        <p className="text-small text-muted">{t("review.writingPaper")}</p>
        {prompt}
        <div className="flex flex-col items-center gap-2">
          <div aria-hidden="true" className="flex flex-wrap justify-center gap-2">
            {characters.map((_, index) => (
              // Characters never move: the index is a stable key.
              <svg
                key={index}
                viewBox="0 0 1024 1024"
                className="size-18 rounded-control border border-hairline"
              >
                <GridLines />
              </svg>
            ))}
          </div>
          <p className="text-small text-muted">
            {t("review.writingCount", { count: characters.length })}
          </p>
        </div>
      </>
    );
  return (
    <>
      {prompt}
      <div className="flex flex-wrap justify-center gap-3">
        {loaded.value.map((data, index) => (
          // Characters never move: the index is a stable key.
          <StrokeOrder key={index} character={characters[index] ?? ""} data={data} compact />
        ))}
      </div>
    </>
  );
};

/**
 * Meaning, pinyin and audio (never played by itself), then the word drawn character by character,
 * or written on paper and self-graded by the review page: "Write on paper" switches, and the choice
 * is kept for the next writing cards.
 */
export const WritingCard = ({
  headword,
  readingKey,
  glosses,
  audio,
  features,
  language,
  focusTarget,
  paperChecked,
  paper,
  revealed,
  onPaperChange,
  onGrade,
  onContinue,
}: Props) => {
  const { t } = useTranslation();
  const [notSaved, setNotSaved] = useState<string | null>(null);
  const strokesOf = features.strokes?.strokesOf ?? null;
  // Started once per word and read under Suspense below the card, which keeps focus meanwhile.
  const strokes: WordStrokes = useMemo(
    () =>
      strokesOf === null
        ? Promise.resolve(err({ kind: "dataset-missing", dataset: "strokes" }))
        : wordStrokes(strokesOf, headword),
    [strokesOf, headword],
  );
  const characters = Array.from(headword);
  const prompt = (
    <>
      <GlossSummary glosses={glosses} language={language} className="text-subtitle font-normal" />
      <div className="flex flex-wrap items-center justify-center gap-4">
        <p>
          <Pinyin reading={readingKey} features={features} className="text-subtitle font-normal" />
        </p>
        {audio !== null && <PlayAudio source={audio} align="center" />}
      </div>
    </>
  );
  return (
    <div
      ref={focusTarget}
      tabIndex={-1}
      className="flex flex-col items-center gap-3 rounded-control"
    >
      <div className="flex items-center justify-between gap-3 self-stretch">
        <p className="text-caption tracking-[0.08em] text-muted uppercase">
          {t("review.writingTitle")}
        </p>
        <Switch
          label={t("review.writingOnPaper")}
          hint={null}
          checked={paperChecked}
          onChange={(next) => {
            const saved = saveSetting(storage, WRITE_ON_PAPER, next);
            setNotSaved(saved.ok ? null : saved.error);
            onPaperChange(next);
          }}
        />
      </div>
      {notSaved !== null && (
        <p role="alert" className="text-danger">
          {t("goal.notSaved", { reason: notSaved })}
        </p>
      )}
      <Suspense fallback={null}>
        {paper ? (
          <Paper strokes={strokes} revealed={revealed} characters={characters} prompt={prompt} />
        ) : (
          <Drawing
            strokes={strokes}
            characters={characters}
            prompt={prompt}
            onGrade={onGrade}
            onContinue={onContinue}
          />
        )}
      </Suspense>
    </div>
  );
};
