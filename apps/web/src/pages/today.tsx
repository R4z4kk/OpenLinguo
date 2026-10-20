import type { DayActivity, Progress as LearnerProgress, Result } from "@openlinguo/core";
import { Link } from "@tanstack/react-router";
import { Flame, Sparkles, type LucideIcon } from "lucide-react";
import { Suspense, use, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { currentSetting, DAILY_GOAL, todayActivity } from "@/data/daily-goal";
import { database } from "@/data/database";
import { localNow } from "@/data/decks";
import { loadProgress, SHOW_PROGRESS, type ProgressFailure } from "@/data/progress";
import { describeFailure } from "@/data/review-log";

const storage = (): Storage => localStorage;

/** A day met by emptying the session below the goal says so, without any loss message. */
const Goal = ({
  activity,
  goal,
}: {
  readonly activity: Promise<Result<DayActivity, ProgressFailure>>;
  readonly goal: number;
}) => {
  const { t } = useTranslation();
  const result = use(activity);
  if (!result.ok)
    return (
      <p role="alert" className="mt-6 text-danger">
        {t("today.failed", { reason: describeFailure(result.error) })}
      </p>
    );
  const { words: done, goalMet } = result.value;
  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <Progress aria-label={t("today.goal")} value={Math.min(done, goal)} max={goal} />
        <span className="shrink-0 text-small text-muted tabular-nums">
          {t("today.goalCount", { done, goal })}
        </span>
      </div>
      {(done >= goal || goalMet) && (
        <p className="mt-2">{t(done >= goal ? "today.goalMet" : "today.goalCleared")}</p>
      )}
    </div>
  );
};

const Chip = ({
  icon: Icon,
  term,
  value,
}: {
  readonly icon: LucideIcon;
  readonly term: string;
  readonly value: string;
}) => (
  <div>
    <dt className="sr-only">{term}</dt>
    <dd className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-3 py-1 text-small tabular-nums">
      <Icon aria-hidden className="size-4" />
      {value}
    </dd>
  </div>
);

/** Streak and XP only: no loss message, no celebration. */
const Chips = ({
  progress,
}: {
  readonly progress: Promise<Result<LearnerProgress, ProgressFailure>>;
}) => {
  const { t } = useTranslation();
  const result = use(progress);
  if (!result.ok)
    return (
      <p role="alert" className="text-danger">
        {t("progress.failed", { reason: describeFailure(result.error) })}
      </p>
    );
  return (
    <dl className="flex flex-wrap gap-2">
      <Chip
        icon={Flame}
        term={t("progress.streak")}
        value={t("progress.days", { count: result.value.streak })}
      />
      <Chip
        icon={Sparkles}
        term={t("progress.xp")}
        value={t("progress.xpCount", { xp: result.value.xp })}
      />
    </dl>
  );
};

export const TodayPage = () => {
  const { t } = useTranslation();
  const [goal] = useState(() => currentSetting(storage, DAILY_GOAL));
  const activity = useMemo(() => todayActivity(database, localNow()), []);
  const progress = useMemo(
    () => (currentSetting(storage, SHOW_PROGRESS) ? loadProgress(database, localNow()) : null),
    [],
  );
  return (
    <section>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title">{t("today.title")}</h1>
        {progress !== null && (
          <Suspense fallback={null}>
            <Chips progress={progress} />
          </Suspense>
        )}
      </header>
      <p className="mt-2 text-muted">{t("today.intro")}</p>
      <Suspense fallback={null}>
        <Goal activity={activity} goal={goal} />
      </Suspense>
      <Link to="/review" className={buttonVariants({ className: "mt-6" })}>
        {t("today.start")}
      </Link>
    </section>
  );
};
