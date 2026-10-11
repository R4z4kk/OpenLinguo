import { proficiencyFrameworks, type Result } from "@openlinguo/core";
import type { ZhProficiency } from "@openlinguo/lang-zh";
import { Link } from "@tanstack/react-router";
import { BookA } from "lucide-react";
import { Suspense, use, useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/data/data-context";
import { database } from "@/data/database";
import { deckCounts, localNow, type DeckCounts, type Decks } from "@/data/decks";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";

const COUNTS = ["new", "learning", "due"] as const;

const Counts = ({ counts }: { readonly counts: DeckCounts }) => {
  const { t } = useTranslation();
  return (
    <dl className="mt-2 flex gap-6">
      {COUNTS.map((count) => (
        <div key={count}>
          <dt className="text-small text-muted">{t(`decks.${count}`)}</dt>
          <dd className="text-subtitle tabular-nums">{counts[count]}</dd>
        </div>
      ))}
    </dl>
  );
};

const DeckList = ({
  decks,
  referential,
}: {
  readonly decks: Promise<Result<Decks, ReviewLogFailure>>;
  readonly referential: ZhProficiency;
}) => {
  const { t } = useTranslation();
  const result = use(decks);
  if (!result.ok)
    return (
      <p role="alert" className="mt-4 text-danger">
        {t("decks.failed", { reason: describeFailure(result.error) })}
      </p>
    );
  const levels = proficiencyFrameworks[referential];
  const named = [
    { name: t("decks.myWords"), counts: result.value.personal },
    ...result.value.bands.map((counts, index) => ({
      name: t("dictionary.level", { level: levels[index] ?? String(index + 1) }),
      counts,
    })),
  ];
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2">
      {named.map(({ name, counts }) => (
        <li key={name} className="rounded-card border border-hairline bg-surface p-4">
          <h3 className="font-semibold">{name}</h3>
          <Counts counts={counts} />
        </li>
      ))}
    </ul>
  );
};

export const LearnPage = () => {
  const { t } = useTranslation();
  const { referential } = useData();
  // Read once per visit: words added on a word page show up when coming back.
  const decks = useMemo(() => deckCounts(database, referential, localNow()), [referential]);
  const decksId = useId();
  return (
    <section>
      <h1 className="text-title">{t("learn.title")}</h1>
      <p className="mt-2 text-muted">{t("learn.intro")}</p>
      <ul className="mt-6 grid max-w-3xl gap-3">
        <li>
          <Link
            to="/learn/dictionary"
            search={{ q: "" }}
            className="flex min-h-11 items-center gap-4 rounded-card border border-hairline bg-surface p-4 hover:bg-sunken"
          >
            <BookA aria-hidden="true" className="size-6 shrink-0" />
            <span>
              <span className="block font-semibold">{t("learn.dictionary")}</span>
              <span className="block text-small text-muted">{t("learn.dictionaryIntro")}</span>
            </span>
          </Link>
        </li>
      </ul>
      <section aria-labelledby={decksId} className="mt-10 max-w-3xl">
        <h2 id={decksId} className="text-subtitle">
          {t("decks.title")}
        </h2>
        <p className="mt-2 text-muted">
          {t("decks.intro", { referential: t(`referential.${referential}`) })}
        </p>
        <Suspense fallback={null}>
          <DeckList decks={decks} referential={referential} />
        </Suspense>
      </section>
    </section>
  );
};
