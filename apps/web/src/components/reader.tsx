import type {
  AnnotatedToken,
  KnownWords,
  LanguagePack,
  TextReadingFeature,
} from "@openlinguo/core";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AiBadge } from "@/components/ai-badge";
import { Passage } from "@/components/reader-passage";
import { SegmentedControl } from "@/components/segmented-control";
import { UnknownWordsLink } from "@/components/unknown-words-link";
import { currentSetting, loadSetting, saveSetting } from "@/data/daily-goal";
import { database, type StoredText } from "@/data/database";
import { annotateText, gapToTarget, readerView, type ReaderView } from "@/data/reader";
import {
  COVERAGE_TARGET,
  PINYIN_MODES,
  READER_PINYIN,
  type PinyinMode,
} from "@/data/reader-settings";
import { describeFailure } from "@/data/review-log";
import {
  describeCoverageFailure,
  knownPercent,
  loadKnownWords,
  wordsToLearn,
} from "@/data/text-coverage";
import { loadText } from "@/data/texts";
import { cn } from "@/lib/utils";

const storage = (): Storage => localStorage;

type Loaded =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly reason: string }
  | {
      readonly status: "ready";
      readonly tokens: readonly AnnotatedToken[];
      readonly known: KnownWords;
    };

const BackToLibrary = () => {
  const { t } = useTranslation();
  return (
    <Link to="/read" className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1">
      <ChevronLeft aria-hidden="true" className="size-5" />
      {t("reader.back")}
    </Link>
  );
};

const CoverageBlock = ({
  view,
  target,
  action,
}: {
  readonly view: ReaderView;
  readonly target: number;
  /** The button that opens the unknown-words panel (#229). */
  readonly action: ReactNode;
}) => {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const { measure, unresolved } = view;
  const percent = measure.total === 0 ? 0 : knownPercent(measure);
  const gap = gapToTarget(percent, target);
  return (
    <section
      aria-labelledby={titleId}
      className="mt-4 rounded-card border border-hairline bg-surface p-4"
    >
      <h2 id={titleId} className="text-small font-semibold text-muted">
        {t("reader.coverageTitle")}
      </h2>
      {measure.total === 0 ? (
        <p className="mt-1">{t("reader.noWords")}</p>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <strong className="text-title">
              {new Intl.NumberFormat(i18n.language, { style: "percent" }).format(percent / 100)}
            </strong>
            <span>
              {gap === 0
                ? t("reader.target.reached", { target })
                : t("reader.target.short", { target, count: gap })}
            </span>
          </p>
          <div
            aria-hidden="true"
            className="relative mt-3 h-3 rounded-full border border-border-strong bg-sunken"
          >
            <div
              className="h-full rounded-l-full bg-ink"
              style={{ width: `${String(percent)}%` }}
            />
            <div
              className="absolute -top-1 h-5 w-0.5 bg-ink"
              style={{ left: `${String(target)}%` }}
            />
          </div>
          <p className="mt-3 text-small text-muted">
            {t("library.toLearn", { count: wordsToLearn(measure) })}.{" "}
            {unresolved.length > 0 && `${t("reader.unresolved", { count: unresolved.length })}. `}
            {t("reader.counted")}
          </p>
        </>
      )}
      {action}
    </section>
  );
};

const Legend = () => {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="mt-4">
      <h2 id={titleId} className="text-small font-semibold text-muted">
        {t("reader.legendTitle")}
      </h2>
      <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-small">
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="w-6 border-b-2 border-dotted border-ink" />
          {t("reader.legendUnknown")}
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="size-[7px] rotate-45 bg-ink" />
          {t("reader.legendReadings")}
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="h-4 w-6 rounded-sm ring-2 ring-ink" />
          {t("reader.legendSelected")}
        </li>
      </ul>
      <p className="mt-2 text-small text-muted">{t("reader.keyboardHint")}</p>
    </section>
  );
};

const PinyinControl = ({
  mode,
  failure,
  onChange,
}: {
  readonly mode: PinyinMode;
  readonly failure: string | null;
  readonly onChange: (mode: PinyinMode) => void;
}) => {
  const { t } = useTranslation();
  return (
    <div className="mt-4">
      <SegmentedControl
        legend={t("reader.pinyinLegend")}
        name="readerPinyin"
        options={PINYIN_MODES.map((value) => ({
          value,
          label: t(`reader.pinyin.${value}`),
          lang: null,
        }))}
        value={mode}
        onChange={onChange}
        failure={failure === null ? null : t("goal.notSaved", { reason: failure })}
      />
    </div>
  );
};

/** The passage of a text: coverage, pinyin control, words and legend. */
const Reader = ({
  text,
  pack,
  feature,
}: {
  readonly text: StoredText;
  readonly pack: LanguagePack;
  readonly feature: TextReadingFeature;
}) => {
  const { t, i18n } = useTranslation();
  const ids = useId();
  const [target] = useState(() => currentSetting(storage, COVERAGE_TARGET));
  const [initial] = useState(() => loadSetting(storage, READER_PINYIN));
  const [mode, setMode] = useState<PinyinMode>(initial.ok ? initial.value : READER_PINYIN.fallback);
  const [modeFailure, setModeFailure] = useState<string | null>(initial.ok ? null : initial.error);
  /** `start` of the token of the selected word; the word sheet (#228) opens from it. */
  const [selected, setSelected] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });

  useEffect(() => {
    let active = true;
    performance.mark("reader:start");
    void Promise.all([
      loadKnownWords(database, pack.id),
      annotateText(database, feature, text.body),
    ]).then(([known, tokens]) => {
      if (!active) return;
      performance.mark("reader:annotated");
      if (!known.ok) setLoaded({ status: "failed", reason: describeFailure(known.error) });
      else if (!tokens.ok)
        setLoaded({ status: "failed", reason: describeCoverageFailure(tokens.error) });
      else setLoaded({ status: "ready", tokens: tokens.value, known: known.value });
    });
    return () => {
      active = false;
    };
  }, [pack.id, feature, text.body]);

  const view = useMemo(() => {
    if (loaded.status !== "ready") return null;
    const built = readerView(feature, loaded.tokens, loaded.known, text.readingChoices);
    performance.mark("reader:derived");
    return built;
  }, [loaded, feature, text.readingChoices]);

  useEffect(() => {
    if (view?.ok === true) performance.mark("reader:rendered");
  }, [view]);

  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(
    text.createdAt,
  );
  const failure =
    loaded.status === "failed"
      ? loaded.reason
      : view !== null && !view.ok
        ? describeCoverageFailure(view.error)
        : null;
  const pinyinFailure = view?.ok === true ? view.value.pinyinFailure : null;
  const tokens = loaded.status === "ready" ? loaded.tokens : null;
  return (
    <section aria-labelledby={`${ids}-title`} className="max-w-2xl">
      <BackToLibrary />
      <h1 id={`${ids}-title`} lang="zh-Hans" className="font-zh text-title wrap-anywhere">
        {text.title}
      </h1>
      {text.provenance !== null && (
        <div className="mt-2">
          <AiBadge provenance={text.provenance} />
        </div>
      )}
      <p className="mt-1 text-small text-muted">
        {date} · {t(`library.source.${text.source}`)}
      </p>
      {loaded.status === "loading" && (
        <p role="status" className="mt-4 text-muted">
          {t("reader.loading")}
        </p>
      )}
      {failure !== null && (
        <p role="alert" className="mt-4 text-danger">
          {t("reader.loadFailed", { reason: failure })}
        </p>
      )}
      {view?.ok === true && tokens !== null && (
        <>
          <CoverageBlock
            view={view.value}
            target={target}
            action={<UnknownWordsLink id={text.id} body={text.body} tokens={tokens} />}
          />
          {pinyinFailure === null ? (
            <PinyinControl
              mode={mode}
              failure={modeFailure}
              onChange={(next) => {
                setMode(next);
                const saved = saveSetting(storage, READER_PINYIN, next);
                setModeFailure(saved.ok ? null : saved.error);
              }}
            />
          ) : (
            <p role="alert" className="mt-4 text-danger">
              {t("reader.pinyinFailed", {
                detail:
                  pinyinFailure.kind === "unaligned-reading"
                    ? `${pinyinFailure.text}: ${pinyinFailure.reading}`
                    : pinyinFailure.reading,
              })}
            </p>
          )}
          <div className="mt-4">
            <Passage
              tokens={tokens}
              paragraphs={view.value.paragraphs}
              knowledge={view.value.knowledge}
              spoken={view.value.spoken}
              choices={text.readingChoices}
              mode={pinyinFailure === null ? mode : "none"}
              features={pack.features}
              selected={selected}
              onSelect={setSelected}
              unknownId={`${ids}-unknown`}
              readingsId={`${ids}-readings`}
            />
          </div>
          <span id={`${ids}-unknown`} lang={i18n.language} className="sr-only">
            {t("reader.unknownWord")}
          </span>
          <span id={`${ids}-readings`} lang={i18n.language} className="sr-only">
            {t("reader.severalReadings")}
          </span>
          <Legend />
        </>
      )}
    </section>
  );
};

type Opened =
  | { readonly status: "loading" }
  | { readonly status: "missing" }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "found"; readonly text: StoredText };

/** Opens a text of the library by its id. */
export const TextReader = ({ id, pack }: { readonly id: string; readonly pack: LanguagePack }) => {
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
    return <Reader key={opened.text.id} text={opened.text} pack={pack} feature={feature} />;
  return (
    <section className="max-w-2xl">
      <BackToLibrary />
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
