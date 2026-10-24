import type { AnnotatedToken, LanguagePack, TextReadingFeature } from "@openlinguo/core";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { UnknownWordCard, type CardEvent } from "@/components/unknown-word-card";
import { UnknownWordsLists } from "@/components/unknown-words-lists";
import { WikidataCheck } from "@/components/wikidata-check";
import { database, type StoredText } from "@/data/database";
import { annotateText } from "@/data/reader";
import { describeFailure } from "@/data/review-log";
import { describeCoverageFailure, knownPercent, type Measure } from "@/data/text-coverage";
import { loadText } from "@/data/texts";
import { currentMeasure, listUnknownWords, type UnknownWord } from "@/data/unknown-words";
import { cn } from "@/lib/utils";

const BackToText = ({ id }: { readonly id: string }) => {
  const { t } = useTranslation();
  return (
    <Link
      to="/read/$id"
      params={{ id }}
      className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1"
    >
      <ChevronLeft aria-hidden="true" className="size-5" />
      {t("unknownWords.back")}
    </Link>
  );
};

type Listing =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "ready"; readonly words: readonly UnknownWord[] };

type Announcement = {
  readonly event: CardEvent;
  readonly measure: { readonly percent: number } | { readonly failure: string } | null;
};

const Panel = ({
  text,
  pack,
  feature,
}: {
  readonly text: StoredText;
  readonly pack: LanguagePack;
  readonly feature: TextReadingFeature;
}) => {
  const { t, i18n } = useTranslation();
  const commonId = useId();
  const [tokens, setTokens] = useState<readonly AnnotatedToken[] | null>(null);
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [round, setRound] = useState(0);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    let active = true;
    void annotateText(database, feature, text.body).then((result) => {
      if (!active) return;
      if (result.ok) setTokens(result.value);
      else setListing({ status: "failed", reason: describeCoverageFailure(result.error) });
    });
    return () => {
      active = false;
    };
  }, [feature, text.body]);

  useEffect(() => {
    if (tokens === null) return;
    let active = true;
    void listUnknownWords(database, text.body, tokens).then((result) => {
      if (!active) return;
      setListing(
        result.ok
          ? { status: "ready", words: result.value }
          : { status: "failed", reason: describeCoverageFailure(result.error) },
      );
    });
    return () => {
      active = false;
    };
  }, [tokens, text.body, round]);

  const onEvent = (event: CardEvent): void => {
    latest.current += 1;
    const current = latest.current;
    setAnnouncement({ event, measure: null });
    if (event.kind === "rejected") return;
    void currentMeasure(database, feature, pack.id, text).then((result) => {
      if (latest.current !== current) return;
      const measure = (measured: Measure): { readonly percent: number } | null =>
        measured.total === 0 ? null : { percent: knownPercent(measured) };
      setAnnouncement({
        event,
        measure: result.ok
          ? measure(result.value)
          : { failure: describeCoverageFailure(result.error) },
      });
    });
  };

  const words = listing.status === "ready" ? listing.words : [];
  const main = words.filter(({ compositional }) => !compositional);
  const common = words.filter(({ compositional }) => compositional);
  const percent = (value: number): string =>
    new Intl.NumberFormat(i18n.language, { style: "percent" }).format(value / 100);
  const cards = (list: readonly UnknownWord[]) => (
    <ul className="mt-3 grid gap-4">
      {list.map((word) => (
        <UnknownWordCard key={word.text} word={word} features={pack.features} onEvent={onEvent} />
      ))}
    </ul>
  );

  return (
    <section aria-labelledby={`${commonId}-title`} className="max-w-2xl">
      <BackToText id={text.id} />
      <h1 id={`${commonId}-title`} className="text-title">
        {listing.status === "ready"
          ? t("unknownWords.heading", { count: main.length })
          : t("unknownWords.title")}
      </h1>
      <p lang="zh-Hans" className="mt-1 font-zh text-small text-muted wrap-anywhere">
        {text.title}
      </p>
      <p className="mt-2 text-muted">{t("unknownWords.intro")}</p>
      <UnknownWordsLists
        onChange={() => {
          setRound((previous) => previous + 1);
        }}
      />
      <p role="status" className="mt-4">
        {announcement !== null && (
          <>
            {announcement.event.kind === "rejected" ? (
              t("unknownWords.rejected")
            ) : (
              <Trans
                i18nKey={`unknownWords.${announcement.event.kind}`}
                values={{ headword: announcement.event.headword }}
                components={[
                  <span key="headword" lang="zh-Hans" className="font-zh font-semibold" />,
                ]}
              />
            )}
            {announcement.measure !== null &&
              " " +
                ("percent" in announcement.measure
                  ? t("unknownWords.coverage", { percent: percent(announcement.measure.percent) })
                  : t("unknownWords.coverageFailed", { reason: announcement.measure.failure }))}
          </>
        )}
      </p>
      {listing.status === "ready" && (
        <WikidataCheck
          words={words}
          onChecked={() => {
            setRound((previous) => previous + 1);
          }}
        />
      )}
      {listing.status === "loading" && (
        <p role="status" className="mt-4 text-muted">
          {t("unknownWords.loading")}
        </p>
      )}
      {listing.status === "failed" && (
        <p role="alert" className="mt-4 text-danger">
          {t("unknownWords.loadFailed", { reason: listing.reason })}
        </p>
      )}
      {listing.status === "ready" && words.length === 0 && (
        <p className="mt-4">{t("unknownWords.none")}</p>
      )}
      {main.length > 0 && cards(main)}
      {common.length > 0 && (
        <details className={cn("mt-6 rounded-card border border-hairline p-4")}>
          <summary className="min-h-11 cursor-pointer font-semibold">
            {t("unknownWords.common", { count: common.length })}
          </summary>
          <p className="mt-2 text-muted">{t("unknownWords.commonHelp")}</p>
          {cards(common)}
        </details>
      )}
    </section>
  );
};

type Opened =
  | { readonly status: "loading" }
  | { readonly status: "missing" }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "found"; readonly text: StoredText };

/** The unknown words of a text of the library, by its id. */
export const UnknownWords = ({
  id,
  pack,
}: {
  readonly id: string;
  readonly pack: LanguagePack;
}) => {
  const { t } = useTranslation();
  const [opened, setOpened] = useState<Opened>({ status: "loading" });
  const feature = pack.features.textReading;

  useEffect(() => {
    let active = true;
    void loadText(database, id).then((result) => {
      if (!active) return;
      if (!result.ok) setOpened({ status: "failed", reason: describeFailure(result.error) });
      else if (result.value === null) setOpened({ status: "missing" });
      else setOpened({ status: "found", text: result.value });
    });
    return () => {
      active = false;
    };
  }, [id]);

  if (opened.status === "found" && feature !== null)
    return <Panel key={opened.text.id} text={opened.text} pack={pack} feature={feature} />;
  return (
    <section className="max-w-2xl">
      <Link to="/read" className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1">
        <ChevronLeft aria-hidden="true" className="size-5" />
        {t("reader.back")}
      </Link>
      <h1 className="text-title">{t("read.title")}</h1>
      <p
        role={opened.status === "loading" ? "status" : "alert"}
        className={cn("mt-4", opened.status === "loading" ? "text-muted" : "text-danger")}
      >
        {opened.status === "loading" && t("reader.loading")}
        {opened.status === "missing" && t("reader.notFound")}
        {opened.status === "failed" && t("reader.loadFailed", { reason: opened.reason })}
        {opened.status === "found" && t("reader.unsupported")}
      </p>
    </section>
  );
};
