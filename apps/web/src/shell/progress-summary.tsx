import {
  ACHIEVEMENTS,
  FREEZE_EVERY,
  levelStart,
  MAX_FREEZES,
  type Progress as LearnerProgress,
  type Result,
} from "@openlinguo/core";
import { Award } from "lucide-react";
import { Suspense, use, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Progress } from "@/components/ui/progress";
import { database } from "@/data/database";
import { localNow } from "@/data/decks";
import { loadProgress, type ProgressFailure } from "@/data/progress";
import { describeFailure } from "@/data/review-log";

const Details = ({
  progress,
}: {
  readonly progress: Promise<Result<LearnerProgress, ProgressFailure>>;
}) => {
  const { t } = useTranslation();
  const result = use(progress);
  if (!result.ok)
    return (
      <p role="alert" className="mt-4 text-danger">
        {t("progress.failed", { reason: describeFailure(result.error) })}
      </p>
    );
  const { xp, level, streak, freezes, totals, achievements } = result.value;
  const start = levelStart(level);
  const span = levelStart(level + 1) - start;
  const earned = ACHIEVEMENTS.filter(({ id }) => achievements.includes(id));
  return (
    <>
      <p className="mt-4 font-semibold">{t("progress.level", { level })}</p>
      <div className="mt-2 flex items-center gap-3">
        <Progress aria-label={t("progress.levelProgress")} value={xp - start} max={span} />
        <span className="shrink-0 text-small text-muted tabular-nums">
          {t("progress.toNextLevel", { done: xp - start, total: span, next: level + 1 })}
        </span>
      </div>
      <dl className="mt-6 flex flex-wrap gap-x-6 gap-y-4">
        {[
          [t("progress.streak"), t("progress.days", { count: streak })],
          [t("progress.longestStreak"), t("progress.days", { count: totals.longestStreak })],
          [t("progress.freezes"), String(freezes)],
        ].map(([term, value]) => (
          <div key={term}>
            <dt className="text-small text-muted">{term}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-small text-muted">
        {t("progress.freezesHint", { every: FREEZE_EVERY, max: MAX_FREEZES })}
      </p>
      <h3 className="mt-6 font-semibold">
        {t("progress.achievements")}{" "}
        <span className="font-normal text-muted">
          {t("progress.achievementCount", { earned: earned.length, total: ACHIEVEMENTS.length })}
        </span>
      </h3>
      {earned.length === 0 ? (
        <p className="mt-2 text-muted">{t("progress.noAchievements")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {earned.map(({ id, metric, threshold }) => (
            <li key={id} className="flex items-center gap-2">
              <Award aria-hidden className="size-4 shrink-0" />
              {t(`progress.milestones.${metric}`, { count: threshold })}
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

/** Level, streak and earned achievements; nothing about what is not earned yet. */
export const ProgressSummary = () => {
  const progress = useMemo(() => loadProgress(database, localNow()), []);
  return (
    <Suspense fallback={null}>
      <Details progress={progress} />
    </Suspense>
  );
};
