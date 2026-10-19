import type { LanguagePack, Result } from "@openlinguo/core";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { Suspense, use, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CorrectionView, useCorrection } from "@/components/correction";
import { Button } from "@/components/ui/button";
import { loadAiConnection, type AiConnection } from "@/data/ai-settings";
import { currentCorrections, isCorrected, type Corrections } from "@/data/correction";
import { useData } from "@/data/data-context";
import { database, type StoredJournalEntry } from "@/data/database";
import { localNow } from "@/data/decks";
import {
  journalDay,
  journalSentences,
  listPastEntries,
  loadJournalEntry,
  saveJournalEntry,
  type JournalEntry,
} from "@/data/journal";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";
import { languages, type Language } from "@/i18n/language";
import { cn } from "@/lib/utils";
import { dayParam, formatDay } from "@/pages/challenges";

type Loaded<T> = Promise<Result<T, ReviewLogFailure>>;

type EntryProps = {
  readonly entry: JournalEntry;
  /** Today's entry; an earlier one is read-only. */
  readonly editable: boolean;
  readonly pack: LanguagePack;
  readonly language: Language;
  /** The « Correction » heading, under the page's own. */
  readonly level: "h2" | "h3";
};

/**
 * The entry, a field on its own day; « Correct » once a provider is set, until each sentence has its
 * correction, then the correction of each sentence.
 */
const Entry = ({ entry, editable, pack, language, level }: EntryProps) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const id = useId();
  const prompts = pack.prompts;
  const [text, setText] = useState(entry.text);
  const [corrections, setCorrections] = useState<Corrections>(entry.corrections);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Result<boolean, ReviewLogFailure> | null>(null);
  const [connection, setConnection] = useState<Result<
    AiConnection | null,
    ReviewLogFailure
  > | null>(null);

  useEffect(() => {
    let current = true;
    void loadAiConnection(database).then((result) => {
      if (current) setConnection(result);
    });
    return () => {
      current = false;
    };
  }, []);

  const sentences = journalSentences(text);
  const current = currentCorrections(sentences, corrections);
  const corrected = isCorrected(sentences, corrections);

  const store = (next: Corrections): Promise<Result<boolean, ReviewLogFailure>> =>
    saveJournalEntry(database, { day: entry.day, text, corrections: next }, Date.now());

  const keep = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const result = await store(corrections);
    setBusy(false);
    setSaved(result);
  };

  const save = editable ? (
    <Button variant="outline" aria-disabled={busy} onClick={() => void keep()}>
      {t("journal.save")}
    </Button>
  ) : null;
  const correction = useCorrection({
    feature: "journal",
    source:
      connection?.ok === true && connection.value !== null && prompts !== null
        ? { connection: connection.value, task: prompts.correction }
        : null,
    word: null,
    sentences,
    language,
    secondary: save,
    onCorrected: (next) => {
      void store(next).then((stored) => {
        setSaved(stored);
        if (stored.ok) setCorrections(next);
      });
    },
    onLater: () => {
      if (editable) void keep();
      else void navigate({ to: "/learn/journal" });
    },
  });

  const Heading = level;
  return (
    <>
      {editable ? (
        <div className="mt-4 flex flex-col gap-2">
          <label htmlFor={`${id}-text`} className="font-semibold">
            {t("journal.entry", { date: formatDay(entry.day, i18n.language) })}
          </label>
          <textarea
            id={`${id}-text`}
            lang="zh-Hans"
            rows={4}
            aria-describedby={`${id}-help`}
            value={text}
            readOnly={correction.running}
            onChange={(event) => {
              setSaved(null);
              setText(event.target.value);
            }}
            className="w-full rounded-control border border-border-strong bg-surface p-3 font-zh text-pinyin read-only:bg-sunken"
          />
          <p id={`${id}-help`} className="text-small text-muted">
            {t("journal.sensitive")}
          </p>
        </div>
      ) : sentences.length === 0 ? (
        <p className="mt-4 text-muted">{t("journal.emptyEntry")}</p>
      ) : (
        <p lang="zh-Hans" className="mt-4 font-zh text-pinyin whitespace-pre-wrap">
          {text}
        </p>
      )}
      {!corrected && correction.controls !== null
        ? correction.controls
        : save !== null && <div className="mt-6 flex flex-wrap items-center gap-2">{save}</div>}
      {!corrected && connection?.ok === true && connection.value === null && (
        <p className="mt-2 text-small text-muted">
          {t("journal.providerBefore")}
          <Link to="/profile" hash="ai" className="underline">
            {t("journal.providerLink")}
          </Link>
          {t("journal.providerAfter")}
        </p>
      )}
      {connection?.ok === false && (
        <p role="alert" className="mt-2 text-danger">
          {t("ai.loadFailed", { reason: describeFailure(connection.error) })}
        </p>
      )}
      {editable && (
        <p role="status" className="mt-2 text-small">
          {saved?.ok === true && t("journal.saved")}
        </p>
      )}
      {saved?.ok === false && (
        <p role="alert" className="mt-2 text-danger">
          {t("journal.saveFailed", { reason: describeFailure(saved.error) })}
        </p>
      )}
      {correction.warning}
      {prompts !== null && current.some((item) => item !== null) && (
        <>
          <Heading className={level === "h2" ? "mt-8 text-subtitle" : "mt-6 font-semibold"}>
            {t("correction.title")}
          </Heading>
          <CorrectionView
            corrections={current}
            prompts={prompts}
            features={pack.features}
            onChoose={async (index, choice) => {
              const next = current.map((item, at) =>
                at === index && item !== null ? { ...item, choice } : item,
              );
              const stored = await store(next);
              if (!stored.ok) return stored;
              setCorrections(next);
              return { ok: true, value: null };
            }}
          />
        </>
      )}
    </>
  );
};

const Pill = ({ corrected }: { readonly corrected: boolean }) => {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "flex-none rounded-full border border-border-strong px-2 py-0.5 text-caption font-semibold",
        !corrected && "border-dashed text-muted",
      )}
    >
      {t(corrected ? "journal.corrected" : "journal.uncorrected")}
    </span>
  );
};

const Past = ({ list }: { readonly list: Loaded<readonly StoredJournalEntry[]> }) => {
  const { t, i18n } = useTranslation();
  const result = use(list);
  if (!result.ok)
    return (
      <p role="alert" className="mt-4 text-danger">
        {t("journal.loadFailed", { reason: describeFailure(result.error) })}
      </p>
    );
  if (result.value.length === 0) return <p className="mt-4">{t("journal.noPast")}</p>;
  return (
    <ul className="mt-4 flex flex-col gap-2">
      {result.value.map(({ day, text, corrections }) => {
        const sentences = journalSentences(text);
        const first = sentences[0] ?? null;
        return (
          <li key={day}>
            <Link
              to="/learn/journal/$day"
              params={{ day }}
              className="flex min-h-11 items-center gap-3 rounded-card border border-hairline bg-surface px-4 py-3 hover:bg-sunken"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{formatDay(day, i18n.language)}</span>
                {first === null ? (
                  <span className="text-muted">{t("journal.emptyEntry")}</span>
                ) : (
                  <span lang="zh-Hans" className="truncate font-zh">
                    {first}
                  </span>
                )}
              </span>
              <Pill corrected={isCorrected(sentences, corrections)} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
};

const Today = ({
  day,
  entry,
  pack,
  language,
}: {
  readonly day: string;
  readonly entry: Loaded<JournalEntry | null>;
  readonly pack: LanguagePack;
  readonly language: Language;
}) => {
  const { t } = useTranslation();
  const result = use(entry);
  if (!result.ok)
    return (
      <p role="alert" className="mt-4 text-danger">
        {t("journal.loadFailed", { reason: describeFailure(result.error) })}
      </p>
    );
  return (
    <Entry
      entry={result.value ?? { day, text: "", corrections: [] }}
      editable
      pack={pack}
      language={language}
      level="h3"
    />
  );
};

const useLanguage = (): Language => {
  const { i18n } = useTranslation();
  return languages.find((lang) => lang === i18n.language) ?? "en";
};

/** Learn › Journal: today's entry, then the earlier ones, the latest first. */
export const JournalPage = () => {
  const { t } = useTranslation();
  const { state } = useData();
  const language = useLanguage();
  const day = useMemo(() => journalDay(localNow()), []);
  const today = useMemo(() => loadJournalEntry(database, day), [day]);
  const past = useMemo(() => listPastEntries(database, day), [day]);
  return (
    <section className="max-w-2xl">
      <Link to="/learn" className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1">
        <ChevronLeft aria-hidden="true" className="size-5" />
        {t("nav.learn")}
      </Link>
      <h1 className="text-title">{t("journal.title")}</h1>
      <p className="mt-2 text-muted">{t("journal.intro")}</p>
      <h2 className="mt-8 text-subtitle">{t("journal.today")}</h2>
      {state.status === "ready" && (
        <Suspense fallback={null}>
          <Today day={day} entry={today} pack={state.pack} language={language} />
        </Suspense>
      )}
      <h2 className="mt-8 text-subtitle">{t("journal.past")}</h2>
      <Suspense fallback={null}>
        <Past list={past} />
      </Suspense>
    </section>
  );
};

const Saved = ({
  entry,
  pack,
  language,
}: {
  readonly entry: Loaded<JournalEntry | null>;
  readonly pack: LanguagePack;
  readonly language: Language;
}) => {
  const { t } = useTranslation();
  const result = use(entry);
  if (!result.ok)
    return (
      <p role="alert" className="mt-6 text-danger">
        {t("journal.loadFailed", { reason: describeFailure(result.error) })}
      </p>
    );
  if (result.value === null) return <p className="mt-6">{t("journal.notFound")}</p>;
  return <Entry entry={result.value} editable={false} pack={pack} language={language} level="h2" />;
};

/** An earlier entry, opened from the list: read-only, corrected on demand. */
export const JournalEntryPage = () => {
  const { t, i18n } = useTranslation();
  const { state } = useData();
  const language = useLanguage();
  const day = dayParam(useParams({ strict: false }));
  const entry = useMemo(() => loadJournalEntry(database, day), [day]);
  return (
    <section className="max-w-2xl">
      <Link to="/learn/journal" className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1">
        <ChevronLeft aria-hidden="true" className="size-5" />
        {t("journal.back")}
      </Link>
      <h1 className="text-title">{t("journal.entry", { date: formatDay(day, i18n.language) })}</h1>
      {state.status === "ready" && (
        <Suspense fallback={null}>
          <Saved entry={entry} pack={state.pack} language={language} />
        </Suspense>
      )}
    </section>
  );
};
