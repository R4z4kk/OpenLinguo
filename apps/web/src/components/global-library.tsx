import type { LanguagePack } from "@openlinguo/core";
import { BANDS, bandName } from "@openlinguo/core/moderation";
import type { LibraryItem, LibrarySummary } from "@openlinguo/core/submission";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiBadge } from "@/components/ai-badge";
import { NewTabLink } from "@/components/new-tab-link";
import { CoverageLine, type Stats } from "@/components/text-library";
import { failureMessage } from "@/components/text-form";
import { Button } from "@/components/ui/button";
import type { ApiFailure } from "@/data/api";
import { database } from "@/data/database";
import { importLibraryItem, listLibrary, loadLibraryItem } from "@/data/global-library";
import { loadLexicon } from "@/data/lexicon";
import { describeFailure } from "@/data/review-log";
import { describeCoverageFailure, loadKnownWords, measureText } from "@/data/text-coverage";
import { loadText } from "@/data/texts";
import { fieldClass } from "@/shell/ai-settings";

const useLibraryFailure = () => {
  const { t } = useTranslation();
  return (failure: ApiFailure): string => {
    switch (failure.kind) {
      case "offline":
        return t("globalLibrary.failure.offline");
      case "unexpected":
        return t("globalLibrary.failure.unexpected", { status: failure.status });
      case "rate-limited":
        return t("globalLibrary.failure.unexpected", { status: 429 });
      case "refused":
        return failure.code === "NOT_FOUND"
          ? t("globalLibrary.failure.notFound")
          : t("globalLibrary.failure.unexpected", { status: failure.code });
    }
  };
};

const LoadFailure = ({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) => {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <p role="alert" className="text-danger">
        {message}
      </p>
      <Button variant="outline" onClick={onRetry}>
        {t("globalLibrary.retry")}
      </Button>
    </div>
  );
};

const BandPill = ({ band }: { readonly band: number }) => {
  const { t } = useTranslation();
  return (
    <span className="self-start rounded-full border border-border-strong px-2 text-caption font-semibold">
      {t("globalLibrary.estimated", { band: bandName(band) })}
    </span>
  );
};

/** Origin and signature, then the publication date and the licence. */
const Credits = ({ item }: { readonly item: LibrarySummary }) => {
  const { t, i18n } = useTranslation();
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(
    new Date(item.publishedAt),
  );
  return (
    <>
      <p className="text-small">
        {t(`submit.${item.origin}.origin`)} ·{" "}
        {item.attribution === null ? (
          t("submit.anonymous")
        ) : (
          <span lang="zh-Hans">{t("submit.by", { name: item.attribution })}</span>
        )}
      </p>
      <p className="text-small text-muted">
        {t("globalLibrary.published", { date })} ·{" "}
        <NewTabLink href={t(`submit.${item.origin}.url`)}>
          {t(`submit.${item.origin}.name`)}
        </NewTabLink>
      </p>
    </>
  );
};

type Import =
  | { readonly status: "checking" }
  | { readonly status: "absent" }
  | { readonly status: "importing" }
  | { readonly status: "present"; readonly added: boolean }
  | { readonly status: "failed"; readonly message: string };

/** « Importer », then « Déjà dans Mes textes » with a link to the reader. */
const ImportButton = ({
  summary,
  item,
}: {
  readonly summary: LibrarySummary;
  readonly item: LibraryItem | null;
}) => {
  const { t } = useTranslation();
  const describe = useLibraryFailure();
  const [state, setState] = useState<Import>({ status: "checking" });

  useEffect(() => {
    let active = true;
    void loadText(database, summary.id).then((found) => {
      if (!active) return;
      if (!found.ok) {
        setState({ status: "failed", message: failureMessage(t, found.error) });
        return;
      }
      setState(found.value === null ? { status: "absent" } : { status: "present", added: false });
    });
    return () => {
      active = false;
    };
  }, [summary.id, t]);

  const run = async () => {
    if (state.status === "importing" || state.status === "present") return;
    setState({ status: "importing" });
    const loaded =
      item === null ? await loadLibraryItem(summary.id) : { ok: true as const, value: item };
    if (!loaded.ok) {
      setState({ status: "failed", message: describe(loaded.error) });
      return;
    }
    const imported = await importLibraryItem(database, loaded.value, Date.now());
    setState(
      imported.ok
        ? { status: "present", added: true }
        : { status: "failed", message: failureMessage(t, imported.error) },
    );
  };

  const present = state.status === "present";
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="outline"
        aria-disabled={present || state.status === "importing" || state.status === "checking"}
        aria-label={
          present
            ? t("globalLibrary.importedLabel", { title: summary.title })
            : t("globalLibrary.importLabel", { title: summary.title })
        }
        onClick={() => void run()}
      >
        {present
          ? t("globalLibrary.imported")
          : state.status === "importing"
            ? t("globalLibrary.importing")
            : t("globalLibrary.import")}
      </Button>
      <p role="status" className={state.status === "failed" ? "text-danger" : "text-small"}>
        {state.status === "failed" && state.message}
        {present && state.added && `${t("globalLibrary.added")} `}
        {present && (
          <Link
            to="/read/$id"
            params={{ id: summary.id }}
            className="inline-flex min-h-11 items-center underline"
          >
            {t("globalLibrary.open")}
          </Link>
        )}
      </p>
    </div>
  );
};

/** « Signaler », named after its text (DSA art. 16). */
const ReportLink = ({ item }: { readonly item: LibrarySummary }) => {
  const { t } = useTranslation();
  return (
    <Link
      to="/report"
      search={{ text: item.id }}
      aria-label={t("report.linkLabel", { title: item.title })}
      className="inline-flex min-h-11 items-center underline"
    >
      {t("report.link")}
    </Link>
  );
};

const BackLink = ({ to }: { readonly to: "/read" | "/read/library" }) => {
  const { t } = useTranslation();
  return (
    <Link to={to} className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1">
      <ChevronLeft aria-hidden="true" className="size-5" />
      {to === "/read" ? t("globalLibrary.back") : t("globalLibrary.toPreview")}
    </Link>
  );
};

type Listing =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly failure: ApiFailure }
  | { readonly status: "ready" };

/** Read › « Bibliothèque globale »: the approved texts, the latest first (ADR 0015). */
export const GlobalLibrary = () => {
  const { t } = useTranslation();
  const describe = useLibraryFailure();
  const id = useId();
  const [band, setBand] = useState<number | null>(null);
  const [items, setItems] = useState<readonly LibrarySummary[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [page, setPage] = useState<number | null>(null);
  const [listing, setListing] = useState<Listing>({ status: "loading" });
  const [round, setRound] = useState(0);

  useEffect(() => {
    let active = true;
    void listLibrary({ band, page }).then((listed) => {
      if (!active) return;
      if (!listed.ok) {
        setListing({ status: "failed", failure: listed.error });
        return;
      }
      setItems((before) =>
        page === null ? listed.value.items : [...before, ...listed.value.items],
      );
      setNextPage(listed.value.nextPage);
      setListing({ status: "ready" });
    });
    return () => {
      active = false;
    };
  }, [band, page, round]);

  return (
    <section className="max-w-2xl">
      <BackLink to="/read" />
      <h1 className="text-title">{t("globalLibrary.title")}</h1>
      <p className="mt-2 text-muted">{t("globalLibrary.intro")}</p>
      <div className="mt-6 flex flex-col gap-2">
        <label htmlFor={`${id}-band`} className="font-semibold">
          {t("globalLibrary.level")}
        </label>
        <select
          id={`${id}-band`}
          value={band === null ? "" : String(band)}
          onChange={(event) => {
            const { value } = event.currentTarget;
            setItems([]);
            setPage(null);
            setListing({ status: "loading" });
            setBand(value === "" ? null : Number(value));
          }}
          className={`${fieldClass} sm:w-60`}
        >
          <option value="">{t("globalLibrary.allLevels")}</option>
          {Array.from({ length: BANDS }, (_, index) => (
            <option key={index} value={String(index + 1)}>
              {t("globalLibrary.band", { band: bandName(index + 1) })}
            </option>
          ))}
        </select>
      </div>
      {items.length > 0 && (
        <ul className="mt-6 flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-card border border-hairline bg-surface p-4"
            >
              <h2 lang="zh-Hans" className="font-zh text-pinyin font-semibold wrap-anywhere">
                <Link
                  to="/read/library/$id"
                  params={{ id: item.id }}
                  className="inline-flex min-h-11 items-center underline"
                >
                  {item.title}
                </Link>
              </h2>
              <BandPill band={item.band} />
              {item.provenance !== null && <AiBadge provenance={item.provenance} />}
              <Credits item={item} />
              <div className="flex flex-wrap items-start gap-3">
                <ImportButton summary={item} item={null} />
                <ReportLink item={item} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {listing.status === "ready" && items.length === 0 && (
        <p className="mt-6 rounded-card border border-dashed border-border-strong p-4">
          {t("globalLibrary.empty")}
        </p>
      )}
      <p role="status" className="mt-4 text-muted">
        {listing.status === "loading"
          ? page === null
            ? t("globalLibrary.loading")
            : t("globalLibrary.loadingMore")
          : ""}
      </p>
      {listing.status === "failed" && (
        <LoadFailure
          message={describe(listing.failure)}
          onRetry={() => {
            setListing({ status: "loading" });
            setRound((count) => count + 1);
          }}
        />
      )}
      {listing.status === "ready" && nextPage !== null && (
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => {
            setListing({ status: "loading" });
            setPage(nextPage);
          }}
        >
          {t("globalLibrary.more")}
        </Button>
      )}
    </section>
  );
};

type Preview =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly failure: ApiFailure }
  | { readonly status: "ready"; readonly item: LibraryItem };

/** The learner's coverage of this one text, computed on the device. */
const usePreviewStats = (item: LibraryItem | null, pack: LanguagePack): Stats | null => {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    const feature = pack.features.textReading;
    if (item === null || feature === null) return;
    let active = true;
    const run = async (): Promise<Stats> => {
      const known = await loadKnownWords(database, pack.id);
      if (!known.ok) return { status: "failed", reason: describeCoverageFailure(known.error) };
      const lexicon = await loadLexicon(database);
      if (!lexicon.ok) return { status: "failed", reason: describeFailure(lexicon.error) };
      const measure = await measureText(
        feature,
        known.value,
        { body: item.body, readingChoices: {} },
        lexicon.value.headwords,
      );
      return measure.ok
        ? { status: "ready", measure: measure.value }
        : { status: "failed", reason: describeCoverageFailure(measure.error) };
    };
    void run().then((measured) => {
      if (active) setStats(measured);
    });
    return () => {
      active = false;
    };
  }, [item, pack]);
  return stats;
};

/** Read › « Bibliothèque globale » › a text: the passage, the coverage and the licence. */
export const LibraryPreview = ({
  id,
  pack,
}: {
  readonly id: string;
  readonly pack: LanguagePack;
}) => {
  const { t } = useTranslation();
  const describe = useLibraryFailure();
  const ids = useId();
  const [preview, setPreview] = useState<Preview>({ status: "loading" });
  const [round, setRound] = useState(0);
  const item = preview.status === "ready" ? preview.item : null;
  const stats = usePreviewStats(item, pack);

  useEffect(() => {
    let active = true;
    void loadLibraryItem(id).then((loaded) => {
      if (!active) return;
      setPreview(
        loaded.ok
          ? { status: "ready", item: loaded.value }
          : { status: "failed", failure: loaded.error },
      );
    });
    return () => {
      active = false;
    };
  }, [id, round]);

  return (
    <section className="max-w-2xl" aria-labelledby={`${ids}-title`}>
      <BackLink to="/read/library" />
      {item === null ? (
        <h1 id={`${ids}-title`} className="text-title">
          {t("globalLibrary.title")}
        </h1>
      ) : (
        <h1 id={`${ids}-title`} lang="zh-Hans" className="font-zh text-title wrap-anywhere">
          {item.title}
        </h1>
      )}
      {preview.status === "loading" && (
        <p role="status" className="mt-4 text-muted">
          {t("globalLibrary.loading")}
        </p>
      )}
      {preview.status === "failed" &&
        (preview.failure.kind === "refused" && preview.failure.code === "NOT_FOUND" ? (
          <p role="alert" className="mt-4 text-danger">
            {t("globalLibrary.failure.notFound")}
          </p>
        ) : (
          <LoadFailure
            message={describe(preview.failure)}
            onRetry={() => {
              setPreview({ status: "loading" });
              setRound((count) => count + 1);
            }}
          />
        ))}
      {item !== null && (
        <>
          <div className="mt-2 flex flex-col gap-2">
            <BandPill band={item.band} />
            {item.provenance !== null && <AiBadge provenance={item.provenance} />}
            <Credits item={item} />
            <CoverageLine stats={stats} />
          </div>
          <div className="mt-2 flex flex-wrap items-start gap-3">
            <ImportButton summary={item} item={item} />
            <ReportLink item={item} />
          </div>
          <h2 className="mt-6 text-subtitle">{t("globalLibrary.text")}</h2>
          <p
            lang="zh-Hans"
            className="mt-2 rounded-card border border-hairline bg-surface p-4 font-zh text-pinyin whitespace-pre-line wrap-anywhere"
          >
            {item.body}
          </p>
          <section aria-labelledby={`${ids}-licence`} className="mt-6">
            <h2 id={`${ids}-licence`} className="text-subtitle">
              {t("globalLibrary.licence")}
            </h2>
            <p className="mt-2">
              <span className="rounded-full border border-border-strong px-2 text-caption font-semibold">
                {t(`submit.${item.origin}.name`)}
              </span>
            </p>
            <p className="mt-2">
              {item.origin === "human"
                ? t("globalLibrary.reuse.human", {
                    author: item.attribution ?? t("globalLibrary.anonymousAuthor"),
                  })
                : t("globalLibrary.reuse.ai")}
            </p>
            <p className="mt-2">
              <NewTabLink href={t(`submit.${item.origin}.url`)}>
                {t(`submit.${item.origin}.link`)}
              </NewTabLink>
            </p>
          </section>
        </>
      )}
    </section>
  );
};
