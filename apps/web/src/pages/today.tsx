import type { Result } from "@openlinguo/core";
import { Link } from "@tanstack/react-router";
import { Suspense, use, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { currentSetting, DAILY_GOAL, reviewsToday } from "@/data/daily-goal";
import { database } from "@/data/database";
import { localNow } from "@/data/decks";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";

const storage = (): Storage => localStorage;

const Goal = ({
  reviews,
  goal,
}: {
  readonly reviews: Promise<Result<number, ReviewLogFailure>>;
  readonly goal: number;
}) => {
  const { t } = useTranslation();
  const result = use(reviews);
  if (!result.ok)
    return (
      <p role="alert" className="mt-6 text-danger">
        {t("today.failed", { reason: describeFailure(result.error) })}
      </p>
    );
  const done = result.value;
  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <Progress aria-label={t("today.goal")} value={Math.min(done, goal)} max={goal} />
        <span className="shrink-0 text-small text-muted tabular-nums">
          {t("today.goalCount", { done, goal })}
        </span>
      </div>
      {done >= goal && <p className="mt-2">{t("today.goalMet")}</p>}
    </div>
  );
};

export const TodayPage = () => {
  const { t } = useTranslation();
  const [goal] = useState(() => currentSetting(storage, DAILY_GOAL));
  const reviews = useMemo(() => reviewsToday(database, localNow()), []);
  return (
    <section>
      <h1 className="text-title">{t("today.title")}</h1>
      <p className="mt-2 text-muted">{t("today.intro")}</p>
      <Suspense fallback={null}>
        <Goal reviews={reviews} goal={goal} />
      </Suspense>
      <Link to="/review" className={buttonVariants({ className: "mt-6" })}>
        {t("today.start")}
      </Link>
    </section>
  );
};
