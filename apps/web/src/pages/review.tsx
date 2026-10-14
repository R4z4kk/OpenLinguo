import { Grade, previewGrades, type LanguagePack, type Result } from "@openlinguo/core";
import { Link } from "@tanstack/react-router";
import {
  Suspense,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { GlossSummary } from "@/components/gloss-summary";
import { PlayAudio } from "@/components/play-audio";
import { RubyWord } from "@/components/ruby-word";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { currentSetting, DAILY_GOAL, NEW_CARDS_PER_DAY } from "@/data/daily-goal";
import { useData } from "@/data/data-context";
import { database } from "@/data/database";
import { localNow, type LocalTime } from "@/data/decks";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";
import { gradeItem, loadSession, type ReviewItem, type Session } from "@/data/session";
import { languages, type Language } from "@/i18n/language";
import { formatInterval } from "@/lib/interval";

const GRADE_KEYS = ["1", "2", "3", "4"];

const storage = (): Storage => localStorage;

const Characters = ({ word }: { readonly word: string }) => (
  <p lang="zh-Hans" className="font-display text-display">
    {word}
  </p>
);

const Card = ({
  item,
  revealed,
  pack,
  language,
  focusTarget,
}: {
  readonly item: ReviewItem;
  readonly revealed: boolean;
  readonly pack: LanguagePack;
  readonly language: Language;
  readonly focusTarget: RefObject<HTMLDivElement | null>;
}) => {
  const { t } = useTranslation();
  const characters = "note" in item ? item.content.characters : item.headword;
  const meaning =
    "note" in item ? (
      <p className="text-subtitle font-normal">{item.content.meaning}</p>
    ) : (
      <GlossSummary
        glosses={item.entry.glosses}
        language={language}
        className="text-subtitle font-normal"
      />
    );
  const word =
    "note" in item ? (
      <>
        <Characters word={characters} />
        {item.content.pinyin !== "" && (
          <p lang="zh-Latn-pinyin" className="font-zh text-subtitle">
            {item.content.pinyin}
          </p>
        )}
      </>
    ) : item.entry.reading === null ? (
      <>
        <Characters word={characters} />
        <p className="text-small text-muted">{t("review.noReading")}</p>
      </>
    ) : (
      <RubyWord
        word={characters}
        reading={item.entry.reading}
        features={pack.features}
        size="display"
      />
    );
  const audio = item.audio === null ? null : <PlayAudio source={item.audio} align="center" />;
  const focus = {
    ref: focusTarget,
    tabIndex: -1,
    className: "flex flex-col items-center gap-4 rounded-control",
  };
  if (!revealed)
    return (
      <div {...focus}>
        <p className="text-small text-muted">{t(`review.${item.type}`)}</p>
        {item.type === "recognition" ? <Characters word={characters} /> : meaning}
      </div>
    );
  return item.type === "recognition" ? (
    <div className="flex flex-col items-center gap-4">
      <div {...focus}>
        {word}
        {meaning}
      </div>
      {audio}
    </div>
  ) : (
    <div className="flex flex-col items-center gap-4">
      <p className="text-small text-muted">{t("review.recall")}</p>
      {meaning}
      <div {...focus}>{word}</div>
      {audio}
    </div>
  );
};

const Ending = ({
  focusTarget,
  children,
}: {
  readonly focusTarget: RefObject<HTMLDivElement | null>;
  readonly children: ReactNode;
}) => (
  <div ref={focusTarget} tabIndex={-1} className="mt-6 flex flex-col items-start gap-4">
    {children}
  </div>
);

/** One card at a time; Space and 1–4 work while focus is in the session (WCAG 2.1.4). */
const Runner = ({
  initial,
  pack,
  language,
}: {
  readonly initial: Session;
  readonly pack: LanguagePack;
  readonly language: Language;
}) => {
  const { t, i18n } = useTranslation();
  const [queue, setQueue] = useState(initial.items);
  const [done, setDone] = useState(0);
  const [revealedAt, setRevealedAt] = useState<LocalTime | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const pending = useRef(false);
  const focusTarget = useRef<HTMLDivElement>(null);
  const current = queue[0] ?? null;

  useEffect(() => {
    focusTarget.current?.focus();
  }, [done, revealedAt]);

  const outcomes = useMemo(
    () =>
      current === null || revealedAt === null
        ? null
        : previewGrades(current.state, revealedAt.at, revealedAt.utcOffsetMinutes),
    [current, revealedAt],
  );

  const submit = async (grade: Grade): Promise<void> => {
    if (current === null || revealedAt === null || pending.current) return;
    pending.current = true;
    const result = await gradeItem(
      database,
      current,
      grade,
      localNow(),
      currentSetting(storage, DAILY_GOAL),
      queue.length === 1,
    );
    pending.current = false;
    if (!result.ok) {
      setFailure(describeFailure(result.error));
      return;
    }
    setFailure(null);
    setQueue(([, ...rest]) => (result.value === null ? rest : [...rest, result.value]));
    setDone((count) => count + 1);
    setRevealedAt(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === " " && revealedAt === null) {
      event.preventDefault();
      setRevealedAt(localNow());
      return;
    }
    const grade =
      revealedAt === null ? null : (Grade.options[GRADE_KEYS.indexOf(event.key)] ?? null);
    if (grade === null) return;
    event.preventDefault();
    void submit(grade);
  };

  const skipped = initial.skipped > 0 && (
    <p className="mt-4 text-small text-muted">{t("review.skipped", { count: initial.skipped })}</p>
  );

  if (current === null)
    return (
      <>
        {skipped}
        <Ending focusTarget={focusTarget}>
          {done === 0 ? (
            <>
              <p>{t("review.empty")}</p>
              <p className="text-muted">{t("review.emptyHint")}</p>
              <Link
                to="/learn/dictionary"
                search={{ q: "" }}
                className={buttonVariants({ variant: "outline" })}
              >
                {t("dictionary.title")}
              </Link>
            </>
          ) : (
            <>
              <p>{t("review.finished", { count: done })}</p>
              <Link to="/" className={buttonVariants({ variant: "outline" })}>
                {t("review.back")}
              </Link>
            </>
          )}
        </Ending>
      </>
    );

  const total = done + queue.length;
  return (
    // eslint-disable-next-line jsx-a11y-x/no-static-element-interactions -- Shortcuts bubble from the focusable card and buttons, so they only work in the session (WCAG 2.1.4).
    <div className="mt-6" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-3">
        <Progress aria-label={t("review.progress")} value={done} max={total} />
        <span className="shrink-0 text-small text-muted tabular-nums">
          {t("review.progressCount", { done, total })}
        </span>
      </div>
      {skipped}
      <div className="mt-6 rounded-card border border-hairline bg-surface p-6 text-center">
        <Card
          key={done}
          item={current}
          revealed={revealedAt !== null}
          pack={pack}
          language={language}
          focusTarget={focusTarget}
        />
      </div>
      {revealedAt === null ? (
        <Button
          className="mt-6 w-full"
          aria-keyshortcuts="Space"
          onClick={() => {
            setRevealedAt(localNow());
          }}
        >
          {t("review.showAnswer")}
        </Button>
      ) : outcomes?.ok === true ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {outcomes.value.map(({ grade, due }, index) => (
            <Button
              key={grade}
              variant={grade === "good" ? "default" : "outline"}
              aria-keyshortcuts={GRADE_KEYS[index] ?? ""}
              className="h-auto flex-col gap-0 py-2"
              onClick={() => void submit(grade)}
            >
              <span>{t(`review.grades.${grade}`)}</span>{" "}
              <span className="text-small font-normal">
                {formatInterval(due - revealedAt.at, i18n.language)}
              </span>
            </Button>
          ))}
        </div>
      ) : null}
      <p className="mt-4 text-small text-muted">{t("review.keys")}</p>
      {(failure !== null || outcomes?.ok === false) && (
        <p role="alert" className="mt-4 text-danger">
          {t("review.gradeFailed", {
            reason: failure ?? (outcomes?.ok === false ? outcomes.error.message : ""),
          })}
        </p>
      )}
    </div>
  );
};

const Loaded = ({
  session,
  pack,
  language,
}: {
  readonly session: Promise<Result<Session, ReviewLogFailure>>;
  readonly pack: LanguagePack;
  readonly language: Language;
}) => {
  const { t } = useTranslation();
  const result = use(session);
  if (!result.ok)
    return (
      <p role="alert" className="mt-6 text-danger">
        {t("review.failed", { reason: describeFailure(result.error) })}
      </p>
    );
  return <Runner initial={result.value} pack={pack} language={language} />;
};

/** The composed session: due cards, then new ones; nothing is stored until a card is graded. */
export const ReviewPage = () => {
  const { t, i18n } = useTranslation();
  const { state, referential } = useData();
  const session = useMemo(
    () =>
      loadSession(database, referential, localNow(), currentSetting(storage, NEW_CARDS_PER_DAY)),
    [referential],
  );
  const language = languages.find((lang) => lang === i18n.language) ?? "en";
  if (state.status !== "ready") return null;
  return (
    <section aria-labelledby="review-title" className="mx-auto max-w-2xl">
      <h1 id="review-title" className="text-title">
        {t("review.title")}
      </h1>
      <Suspense fallback={null}>
        <Loaded session={session} pack={state.pack} language={language} />
      </Suspense>
    </section>
  );
};
