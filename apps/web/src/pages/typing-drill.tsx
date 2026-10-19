import type { ImeFeature, Result } from "@openlinguo/core";
import { Link } from "@tanstack/react-router";
import { Check, ChevronLeft, Timer, X } from "lucide-react";
import { Suspense, use, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GlossSummary } from "@/components/gloss-summary";
import { ImeField } from "@/components/ime-field";
import { PlayAudio } from "@/components/play-audio";
import { Pinyin, type PinyinFeatures } from "@/components/pinyin";
import { SegmentedControl } from "@/components/segmented-control";
import { Switch } from "@/components/switch";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useData } from "@/data/data-context";
import { database } from "@/data/database";
import { entryId } from "@/data/decks";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";
import {
  answer,
  currentWord,
  drawRound,
  endRound,
  loadDrillWords,
  ROUND_MINUTES,
  ROUND_SIZE,
  roundResult,
  startRound,
  tick,
  timeLeft,
  withAudio,
  type DrillWord,
  type EndedRound,
  type Round,
  type RoundMinutes,
  type RoundWord,
  type RunningRound,
} from "@/data/typing-drill";
import { languages, type Language } from "@/i18n/language";
import { formatClock, formatDuration } from "@/lib/interval";

const MINUTE = 60_000;

/** The countdown's refresh period: under a second, so the clock never skips one. */
const TICK = 250;

const Title = () => {
  const { t } = useTranslation();
  return <h1 className="text-title">{t("drill.title")}</h1>;
};

const Setup = ({
  count,
  timed,
  minutes,
  onTimed,
  onMinutes,
  onStart,
}: {
  readonly count: number;
  readonly timed: boolean;
  readonly minutes: RoundMinutes;
  readonly onTimed: (timed: boolean) => void;
  readonly onMinutes: (minutes: RoundMinutes) => void;
  readonly onStart: () => void;
}) => {
  const { t, i18n } = useTranslation();
  return (
    <>
      <Link to="/learn" className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1">
        <ChevronLeft aria-hidden="true" className="size-5" />
        {t("nav.learn")}
      </Link>
      <Title />
      <p className="mt-2 text-muted">{t("drill.intro")}</p>
      {count === 0 ? (
        <>
          <p className="mt-6">{t("drill.empty")}</p>
          <Link
            to="/learn/dictionary"
            search={{ q: "" }}
            className={buttonVariants({ variant: "outline", className: "mt-4" })}
          >
            {t("dictionary.title")}
          </Link>
        </>
      ) : (
        <>
          <p className="mt-2 text-small text-muted">
            {t("drill.rounds", { count, size: ROUND_SIZE })}
          </p>
          <section
            aria-label={t("drill.settings")}
            className="mt-6 flex flex-col gap-4 rounded-card border border-hairline bg-surface p-4"
          >
            <Switch
              label={t("drill.timer")}
              hint={t("drill.timerHint")}
              checked={timed}
              onChange={onTimed}
            />
            {timed && (
              <div className="ms-14 flex flex-col gap-2">
                <SegmentedControl
                  legend={t("drill.duration")}
                  name="drill-minutes"
                  options={ROUND_MINUTES.map((value) => ({
                    value,
                    label: formatDuration(value * MINUTE, i18n.language),
                    lang: null,
                  }))}
                  value={minutes}
                  onChange={onMinutes}
                  failure={null}
                />
                <p className="text-small text-muted">{t("drill.stopAnytime")}</p>
              </div>
            )}
          </section>
          <Button className="mt-6" onClick={onStart}>
            {t("drill.start")}
          </Button>
        </>
      )}
    </>
  );
};

const Hanzi = ({ text }: { readonly text: string }) => (
  <span lang="zh-Hans" className="font-zh">
    {text}
  </span>
);

/** How the previous word went, for the status line. */
const LastWord = ({
  number,
  word,
  typed,
  features,
}: {
  readonly number: number;
  readonly word: RoundWord;
  readonly typed: string;
  readonly features: PinyinFeatures;
}) => {
  const { t } = useTranslation();
  const right = typed === word.headword;
  const Icon = right ? Check : X;
  return (
    <>
      <Icon aria-hidden="true" className="size-[18px] flex-none" />
      <span>
        {t("drill.last", { number })} <Hanzi text={word.headword} />
        {word.entry.reading !== null && (
          <>
            {" "}
            <Pinyin reading={word.entry.reading} features={features} className={null} />
          </>
        )}
        {t(right ? "drill.lastRight" : "drill.lastWrong")}
        {!right && (
          <>
            {" "}
            {t("drill.typed")} <Hanzi text={typed} />
          </>
        )}
      </span>
    </>
  );
};

/** A word at a time in the IME field, without a grade step; the time left is shown, never announced. */
const Running = ({
  round,
  ime,
  features,
  language,
  onChange,
}: {
  readonly round: RunningRound<RoundWord>;
  readonly ime: ImeFeature;
  readonly features: PinyinFeatures;
  readonly language: Language;
  readonly onChange: (round: Round<RoundWord>) => void;
}) => {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const field = useRef<HTMLDivElement>(null);
  const done = round.typed.length;
  const total = round.words.length;
  const word = currentWord(round);
  const previous = round.words[done - 1] ?? null;
  const left = timeLeft(round, now);

  useEffect(() => {
    field.current?.querySelector("input")?.focus();
  }, [done]);

  useEffect(() => {
    if (round.limit === null) return;
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      onChange(tick(round, at));
    }, TICK);
    return () => {
      clearInterval(timer);
    };
  }, [round, onChange]);

  const check = (): void => {
    if (value === "") return;
    onChange(answer(round, value, Date.now()));
    setValue("");
  };

  if (word === null) return null;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Title />
        <div className="flex items-center gap-2">
          {left !== null && (
            <span
              role="timer"
              aria-label={t("drill.timeLeft")}
              className="flex items-center gap-1.5 font-semibold tabular-nums"
            >
              <Timer aria-hidden="true" className="size-5" />
              {formatClock(left)}
            </span>
          )}
          <Button
            variant="outline"
            aria-label={t("drill.stopRound")}
            onClick={() => {
              onChange(endRound(round, Date.now()));
            }}
          >
            {t("drill.stop")}
          </Button>
        </div>
      </div>
      <div className="mt-6 flex items-center gap-3">
        <Progress aria-label={t("drill.progress")} value={done} max={total} />
        <span className="shrink-0 text-small text-muted tabular-nums">
          {t("review.progressCount", { done, total })}
        </span>
      </div>
      <p role="status" className="mt-3 flex min-h-5 items-center gap-2 text-small">
        {previous !== null && (
          <LastWord
            number={done}
            word={previous}
            typed={round.typed[done - 1] ?? ""}
            features={features}
          />
        )}
      </p>
      <div className="mt-6 flex flex-col items-center gap-3 rounded-card border border-hairline bg-surface p-6 text-center">
        <p className="self-start text-caption tracking-[0.08em] text-muted uppercase">
          {t("drill.word", { current: done + 1, total })}
        </p>
        <p className="text-small text-muted">{t("review.typing")}</p>
        <GlossSummary
          glosses={word.entry.glosses}
          language={language}
          className="text-subtitle font-normal"
        />
        {word.audio !== null && <PlayAudio key={done} source={word.audio} align="center" />}
        <div ref={field} className="mt-1 self-stretch">
          <ImeField
            key={done}
            label={t("ime.answer")}
            ime={ime}
            features={features}
            value={value}
            onChange={setValue}
            onSubmit={check}
          />
        </div>
      </div>
      <Button className="mt-6 w-full" onClick={check}>
        {t("review.toneCheck")}
      </Button>
      <p className="mt-4 text-small text-muted">{t("drill.keys")}</p>
    </>
  );
};

const Ended = ({
  round,
  features,
  language,
  onAgain,
}: {
  readonly round: EndedRound<RoundWord>;
  readonly features: PinyinFeatures;
  readonly language: Language;
  readonly onAgain: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);
  const result = roundResult(round);
  const elapsed = formatDuration(result.elapsed, i18n.language);
  const missed = result.outcomes.filter(({ right }) => !right);
  const right = result.outcomes.filter(({ right: isRight }) => isRight);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <>
      <Title />
      <h2 ref={heading} tabIndex={-1} className="mt-4 text-subtitle">
        {t("drill.finished")}
      </h2>
      <p className="mt-1 text-small text-muted">
        {round.limit === null
          ? t("drill.summary", { elapsed })
          : t("drill.timedSummary", { limit: formatDuration(round.limit, i18n.language), elapsed })}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5 rounded-card border border-hairline bg-surface p-4">
          <dt className="text-small text-muted">{t("drill.wordsRight")}</dt>
          <dd className="text-title tabular-nums">
            {t("drill.rightOfTotal", { right: result.right, total: result.outcomes.length })}
          </dd>
          {missed.length > 0 && (
            <dd className="text-small text-muted">
              {t("drill.toWorkOn", { count: missed.length })}
            </dd>
          )}
        </div>
        <div className="flex flex-col gap-0.5 rounded-card border border-hairline bg-surface p-4">
          <dt className="text-small text-muted">{t("drill.perMinute")}</dt>
          <dd className="text-title tabular-nums">{result.perMinute}</dd>
          <dd className="text-small text-muted">
            {t("drill.rightCharacters", { count: result.characters, elapsed })}
          </dd>
        </div>
      </dl>
      {missed.length > 0 && (
        <>
          <h3 className="mt-6 font-semibold">{t("drill.missed")}</h3>
          <ul className="mt-2 border-t border-hairline">
            {missed.map(({ word, typed }) => (
              <li
                key={entryId(word)}
                className="flex flex-col gap-0.5 border-b border-hairline py-3"
              >
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span lang="zh-Hans" className="font-display text-subtitle font-normal">
                    {word.headword}
                  </span>
                  {word.entry.reading !== null && (
                    <Pinyin
                      reading={word.entry.reading}
                      features={features}
                      className="text-pinyin"
                    />
                  )}
                  <GlossSummary glosses={word.entry.glosses} language={language} className={null} />
                </div>
                <p className="text-small text-muted">
                  {typed === null ? (
                    t("drill.notReached")
                  ) : (
                    <>
                      {t("drill.typed")} <Hanzi text={typed} />
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {right.length > 0 && (
        <>
          <h3 className="mt-6 font-semibold">{t("drill.right")}</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {right.map(({ word }) => (
              <li
                key={entryId(word)}
                className="rounded-full border border-hairline px-2.5 py-0.5 text-pinyin"
              >
                <Hanzi text={word.headword} />
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button onClick={onAgain}>{t("drill.again")}</Button>
        <Link to="/learn" className={buttonVariants({ variant: "outline" })}>
          {t("drill.back")}
        </Link>
      </div>
      <p className="mt-4 text-small text-muted">{t("drill.noReview")}</p>
    </>
  );
};

/** Setup, then rounds until the learner leaves; nothing is stored, so no review and no XP. */
const Drill = ({
  words,
  ime,
  features,
  language,
}: {
  readonly words: Promise<Result<readonly DrillWord[], ReviewLogFailure>>;
  readonly ime: ImeFeature;
  readonly features: PinyinFeatures;
  readonly language: Language;
}) => {
  const { t } = useTranslation();
  const loaded = use(words);
  const [timed, setTimed] = useState(false);
  const [minutes, setMinutes] = useState<RoundMinutes>(2);
  const [round, setRound] = useState<Round<RoundWord> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const pending = useRef(false);

  if (!loaded.ok)
    return (
      <>
        <Title />
        <p role="alert" className="mt-6 text-danger">
          {t("drill.failed", { reason: describeFailure(loaded.error) })}
        </p>
      </>
    );

  const start = async (): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    const drawn = await withAudio(database, drawRound(loaded.value, ROUND_SIZE, Math.random));
    pending.current = false;
    if (!drawn.ok) {
      setFailure(t("drill.startFailed", { reason: describeFailure(drawn.error) }));
      return;
    }
    setFailure(null);
    setRound(startRound(drawn.value, Date.now(), timed ? minutes * MINUTE : null));
  };

  return (
    <>
      {round === null ? (
        <Setup
          count={loaded.value.length}
          timed={timed}
          minutes={minutes}
          onTimed={setTimed}
          onMinutes={setMinutes}
          onStart={() => void start()}
        />
      ) : round.endedAt === null ? (
        <Running
          round={round}
          ime={ime}
          features={features}
          language={language}
          onChange={setRound}
        />
      ) : (
        <Ended round={round} features={features} language={language} onAgain={() => void start()} />
      )}
      {failure !== null && (
        <p role="alert" className="mt-4 text-danger">
          {failure}
        </p>
      )}
    </>
  );
};

/** Free typing practice outside FSRS (ADR 0011): rounds of started words, an optional timer. */
export const TypingDrillPage = () => {
  const { t, i18n } = useTranslation();
  const { state, referential } = useData();
  const pack = state.status === "ready" ? state.pack : null;
  const words = useMemo(
    () => (pack === null ? null : loadDrillWords(database, referential)),
    [pack, referential],
  );
  const language = languages.find((lang) => lang === i18n.language) ?? "en";
  if (pack === null || words === null) return null;
  const { ime } = pack.features;
  return (
    <section className="mx-auto max-w-2xl">
      {ime === null ? (
        <>
          <Title />
          <p className="mt-6">{t("drill.unavailable")}</p>
        </>
      ) : (
        <Suspense fallback={null}>
          <Drill words={words} ime={ime} features={pack.features} language={language} />
        </Suspense>
      )}
    </section>
  );
};
