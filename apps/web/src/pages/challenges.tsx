import type { LanguagePack, Result } from "@openlinguo/core";
import { Link, useParams } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { Suspense, use, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChallengeForm } from "@/components/challenge";
import { listChallenges, loadChallenge, type Challenge } from "@/data/challenge";
import { useData } from "@/data/data-context";
import { database, type StoredChallenge } from "@/data/database";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";
import { languages, type Language } from "@/i18n/language";

/** A learning day, `YYYY-MM-DD`, as a date; anything else as it is. */
export const formatDay = (day: string, language: string): string => {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? day
    : new Intl.DateTimeFormat(language, { dateStyle: "long", timeZone: "UTC" }).format(date);
};

export const dayParam = (params: unknown): string =>
  typeof params === "object" && params !== null && "day" in params && typeof params.day === "string"
    ? params.day
    : "";

const List = ({
  list,
}: {
  readonly list: Promise<Result<readonly StoredChallenge[], ReviewLogFailure>>;
}) => {
  const { t, i18n } = useTranslation();
  const result = use(list);
  if (!result.ok)
    return (
      <p role="alert" className="mt-6 text-danger">
        {t("challenge.loadFailed", { reason: describeFailure(result.error) })}
      </p>
    );
  if (result.value.length === 0) return <p className="mt-6">{t("challenge.empty")}</p>;
  return (
    <ul className="mt-6 flex max-w-2xl flex-col gap-2">
      {result.value.map(({ day, headword, sentences }) => {
        const first = sentences.find((sentence) => sentence.trim() !== "") ?? null;
        return (
          <li key={day}>
            <Link
              to="/learn/challenges/$day"
              params={{ day }}
              className="flex min-h-11 flex-col rounded-card border border-hairline bg-surface px-4 py-3 hover:bg-sunken"
            >
              <span className="font-semibold">
                {formatDay(day, i18n.language)} · <span lang="zh-Hans">{headword}</span>
              </span>
              {first === null ? (
                <span className="text-muted">{t("challenge.noSentence")}</span>
              ) : (
                <span lang="zh-Hans" className="font-zh">
                  {first}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
};

/** Learn › Challenges: every saved challenge, the latest day first. */
export const ChallengesPage = () => {
  const { t } = useTranslation();
  const list = useMemo(() => listChallenges(database), []);
  return (
    <section>
      <Link to="/learn" className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1">
        <ChevronLeft aria-hidden="true" className="size-5" />
        {t("nav.learn")}
      </Link>
      <h1 className="text-title">{t("challenge.listTitle")}</h1>
      <p className="mt-2 text-muted">{t("challenge.listIntro")}</p>
      <Suspense fallback={null}>
        <List list={list} />
      </Suspense>
    </section>
  );
};

const Saved = ({
  day,
  challenge,
  pack,
  language,
}: {
  readonly day: string;
  readonly challenge: Promise<Result<Challenge | null, ReviewLogFailure>>;
  readonly pack: LanguagePack;
  readonly language: Language;
}) => {
  const { t, i18n } = useTranslation();
  const result = use(challenge);
  if (result.ok && result.value !== null)
    return (
      <ChallengeForm
        challenge={result.value}
        pack={pack}
        language={language}
        eyebrow={formatDay(day, i18n.language)}
        level="h1"
        focusTarget={null}
        onDone={null}
      />
    );
  return (
    <>
      <p className="text-small text-muted">{formatDay(day, i18n.language)}</p>
      <h1 className="text-title">{t("challenge.title")}</h1>
      {result.ok ? (
        <p className="mt-6">{t("challenge.notFound")}</p>
      ) : (
        <p role="alert" className="mt-6 text-danger">
          {t("challenge.loadFailed", { reason: describeFailure(result.error) })}
        </p>
      )}
    </>
  );
};

/** One day's challenge, opened again from the list. */
export const ChallengePage = () => {
  const { t, i18n } = useTranslation();
  const { state, referential } = useData();
  const day = dayParam(useParams({ strict: false }));
  const challenge = useMemo(() => loadChallenge(database, referential, day), [referential, day]);
  const language = languages.find((lang) => lang === i18n.language) ?? "en";
  return (
    <section className="max-w-2xl">
      <Link to="/learn/challenges" className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1">
        <ChevronLeft aria-hidden="true" className="size-5" />
        {t("challenge.back")}
      </Link>
      {state.status === "ready" && (
        <Suspense fallback={null}>
          <Saved day={day} challenge={challenge} pack={state.pack} language={language} />
        </Suspense>
      )}
    </section>
  );
};
