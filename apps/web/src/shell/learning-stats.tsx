import {
  HEATMAP_WEEKS,
  RECENT_DAYS,
  type HeatmapDay,
  type Result,
  type Stats,
} from "@openlinguo/core";
import { Check } from "lucide-react";
import { Suspense, use, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { database } from "@/data/database";
import { localNow } from "@/data/decks";
import { loadStats, type StatsFailure } from "@/data/progress";
import { describeFailure } from "@/data/review-log";
import { cn } from "@/lib/utils";

type Shade = "none" | "reviewed" | "goalMet";

/** Adjacent shades stay ≥ 3:1 apart in both themes (design/tokens.test.ts). */
const SHADES: Readonly<Record<Shade, string>> = {
  none: "bg-sunken",
  reviewed: "bg-border-strong",
  goalMet: "bg-ink",
};
const LEGEND: readonly Shade[] = ["none", "reviewed", "goalMet"];

const shadeOf = (day: HeatmapDay): Shade =>
  day.goalMet ? "goalMet" : day.reviews > 0 ? "reviewed" : "none";

// 2024-01-01 is a Monday.
const MONDAY = Date.UTC(2024, 0, 1);
const DAY = 24 * 60 * 60_000;

const Details = ({ stats }: { readonly stats: Promise<Result<Stats, StatsFailure>> }) => {
  const { t, i18n } = useTranslation();
  const result = use(stats);
  if (!result.ok)
    return (
      <p role="alert" className="mt-4 text-danger">
        {t("stats.failed", { reason: describeFailure(result.error) })}
      </p>
    );
  const { retention, words, recent, weeks } = result.value;
  const number = new Intl.NumberFormat(i18n.language);
  const weekStart = new Intl.DateTimeFormat(i18n.language, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: "short", timeZone: "UTC" });
  const items: readonly (readonly [string, string, string | null])[] = [
    [
      t("stats.retention", { days: RECENT_DAYS }),
      retention.total === 0
        ? t("stats.notYet")
        : t("stats.percent", { ratio: retention.passed / retention.total }),
      retention.total === 0
        ? t("stats.retentionEmpty")
        : t("stats.retentionDetail", { passed: retention.passed, total: retention.total }),
    ],
    [t("stats.words"), number.format(words), null],
    [
      t("stats.perDay", { days: RECENT_DAYS }),
      recent.studiedDays === 0
        ? t("stats.notYet")
        : t("stats.average", { average: recent.reviews / recent.studiedDays }),
      t("stats.studiedDays", { count: recent.studiedDays, days: RECENT_DAYS }),
    ],
  ];
  return (
    <>
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-4">
        {items.map(([term, value, detail]) => (
          <div key={term}>
            <dt className="text-small text-muted">{term}</dt>
            <dd className="tabular-nums">{value}</dd>
            {detail !== null && <dd className="text-small text-muted">{detail}</dd>}
          </div>
        ))}
      </dl>
      <h3 className="mt-6 font-semibold">{t("stats.heatmap", { weeks: HEATMAP_WEEKS })}</h3>
      {/* The table below holds the same numbers for assistive technologies. */}
      <div aria-hidden className="mt-2">
        <div className="grid w-fit grid-flow-col grid-rows-7 gap-1">
          {weeks
            .flatMap(({ days }) => days)
            .filter((day) => day !== null)
            .map((day) => (
              <span key={day.day} className={cn("size-5 rounded-sm", SHADES[shadeOf(day)])} />
            ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-small text-muted">
          {LEGEND.map((shade) => (
            <span key={shade} className="flex items-center gap-1">
              <span className={cn("size-3 rounded-sm", SHADES[shade])} />
              {t(`stats.shades.${shade}`)}
            </span>
          ))}
        </div>
      </div>
      <details className="mt-2">
        <summary className="flex min-h-11 cursor-pointer items-center underline">
          {t("stats.showNumbers")}
        </summary>
        <table className="text-small tabular-nums">
          <caption className="pb-2 text-left text-muted">
            {t("stats.tableCaption")}{" "}
            <span aria-hidden className="inline-flex items-center gap-1">
              <Check className="size-4" /> {t("stats.shades.goalMet")}
            </span>
          </caption>
          <thead>
            <tr>
              <td />
              {Array.from({ length: 7 }, (_, index) => (
                <th key={index} scope="col" className="px-1 py-1 text-right font-semibold">
                  {weekday.format(MONDAY + index * DAY)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map(({ start, days }) => (
              <tr key={start}>
                <th
                  scope="row"
                  className="py-1 pr-1 text-left font-normal whitespace-nowrap text-muted"
                >
                  {weekStart.format(Date.parse(start))}
                </th>
                {days.map((day, index) => (
                  <td key={day?.day ?? index} className="px-1 py-1 text-right">
                    {day !== null && (
                      <span className="inline-flex items-center gap-0.5">
                        {number.format(day.reviews)}
                        {day.goalMet && (
                          <>
                            <Check aria-hidden className="size-3" />
                            <span className="sr-only">{t("stats.shades.goalMet")}</span>
                          </>
                        )}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
};

/** Retention, words, recent activity, and a reviews heatmap with the same numbers as a table. */
export const LearningStats = () => {
  const stats = useMemo(() => loadStats(database, localNow()), []);
  return (
    <Suspense fallback={null}>
      <Details stats={stats} />
    </Suspense>
  );
};
