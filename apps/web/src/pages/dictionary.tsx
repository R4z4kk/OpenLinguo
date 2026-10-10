import {
  proficiencyFrameworks,
  type DictEntry,
  type LanguageFeatures,
  type LookupError,
} from "@openlinguo/core";
import type { ZhProficiency } from "@openlinguo/lang-zh";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pinyin } from "@/components/pinyin";
import { Button } from "@/components/ui/button";
import { useData } from "@/data/data-context";
import { database } from "@/data/database";
import { summarizeGlosses } from "@/data/gloss-summary";
import { searchDictionary, type SearchResults } from "@/data/search";
import { languages, type Language } from "@/i18n/language";

/** Results shown at once, and added by "Show more". */
const PAGE = 50;
const DEBOUNCE_MS = 200;

export type DictionarySearch = { readonly q: string };

export const validateDictionarySearch = (search: unknown): DictionarySearch => {
  const q = typeof search === "object" && search !== null && "q" in search ? search.q : null;
  // The router reads `?q=123` as a number.
  return { q: typeof q === "string" ? q : typeof q === "number" ? String(q) : "" };
};

const useDebounced = <Value,>(value: Value, delay: number): Value => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);
  return debounced;
};

type SearchState =
  | { readonly status: "done"; readonly query: string; readonly results: SearchResults }
  | { readonly status: "failed"; readonly failure: LookupError };

const NO_RESULTS: SearchState = { status: "done", query: "", results: { total: 0, entries: [] } };

const useDictionarySearch = (
  query: string,
  limit: number,
  referential: ZhProficiency,
): SearchState => {
  const [state, setState] = useState<SearchState>(NO_RESULTS);
  useEffect(() => {
    let active = true;
    void searchDictionary(database, referential, query, limit).then((result) => {
      if (!active) return;
      setState(
        result.ok
          ? { status: "done", query, results: result.value }
          : { status: "failed", failure: result.error },
      );
    });
    return () => {
      active = false;
    };
  }, [query, limit, referential]);
  return state;
};

const failureMessage = (t: TFunction, failure: LookupError): string =>
  failure.kind === "storage-failure"
    ? t("dataImport.unreadable", { message: failure.message })
    : t("dataImport.missing", { dataset: failure.dataset });

/** Glosses in the interface language, else in the other one with its name shown. */
const GlossSummary = ({
  entry,
  language,
}: {
  readonly entry: DictEntry;
  readonly language: Language;
}) => {
  const { t } = useTranslation();
  const summary = summarizeGlosses(entry.glosses, [
    language,
    ...languages.filter((lang) => lang !== language),
  ]);
  if (summary === null) return null;
  return (
    <p className="mt-1 line-clamp-2">
      {summary.lang !== language && (
        <>
          <span className="rounded-full border border-border-strong px-2 text-caption text-muted">
            {t(`dictionary.glossesIn.${summary.lang}`)}
          </span>{" "}
        </>
      )}
      <span lang={summary.lang}>
        {summary.texts.join(summary.lang === "fr" ? "\u00a0; " : "; ")}
      </span>
    </p>
  );
};

const ResultItem = ({
  entry,
  features,
  referential,
  language,
}: {
  readonly entry: DictEntry;
  readonly features: LanguageFeatures;
  readonly referential: ZhProficiency;
  readonly language: Language;
}) => {
  const { t } = useTranslation();
  const level = entry.level === null ? null : proficiencyFrameworks[referential][entry.level - 1];
  return (
    <li className="py-4">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span lang="zh-Hans" className="font-zh text-subtitle">
          {entry.headword}
        </span>
        {entry.variants.length > 0 && (
          <span lang="zh-Hant" className="font-zh text-muted">
            {entry.variants.join(" ")}
          </span>
        )}
        {entry.reading !== null && (
          <Pinyin reading={entry.reading} features={features} className="text-pinyin" />
        )}
        {level != null && (
          <span className="rounded-full border border-border-strong px-2 text-caption">
            {t("dictionary.level", { level })}
          </span>
        )}
      </p>
      <GlossSummary entry={entry} language={language} />
    </li>
  );
};

const CREDITS = [
  {
    id: "cc-cedict",
    name: "CC-CEDICT",
    url: "https://www.mdbg.net/chinese/dictionary?page=cc-cedict",
    holder: "MDBG",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
  {
    id: "cfdict",
    name: "CFDICT",
    url: "https://chine.in/chinois/open/CFDICT/",
    holder: "Chine Informations",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
  },
  {
    id: "wiktionary-fr",
    name: "Wiktionnaire",
    url: "https://kaikki.org/frwiktionary/Chinois/index.html",
    holder: "kaikki.org",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
  {
    id: "wordfreq",
    name: "wordfreq",
    url: "https://github.com/rspeer/wordfreq",
    holder: "Robyn Speer",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
] as const;

const Credits = () => {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <footer
      aria-labelledby={titleId}
      className="mt-12 border-t border-hairline pt-4 text-small text-muted"
    >
      <h2 id={titleId} className="font-semibold">
        {t("dictionary.sources")}
      </h2>
      <ul className="mt-2">
        {CREDITS.map((credit) => (
          <li key={credit.id}>
            {t(`dictionary.credits.${credit.id}`)}{" "}
            <a href={credit.url} className="underline">
              {credit.name}
            </a>{" "}
            ({credit.holder},{" "}
            <a href={credit.licenseUrl} className="underline">
              {credit.license}
            </a>
            )
          </li>
        ))}
      </ul>
    </footer>
  );
};

/** Search by characters, pinyin with or without tones, English or French, offline. */
export const DictionaryPage = () => {
  const { t, i18n } = useTranslation();
  const { state, referential } = useData();
  // The router's search types resolve to `any`: the URL is validated here as well.
  const { q } = validateDictionarySearch(useSearch({ strict: false }));
  const navigate = useNavigate({ from: "/learn/dictionary" });
  const [text, setText] = useState(q);
  const query = useDebounced(text.trim(), DEBOUNCE_MS);
  const [extended, setExtended] = useState({ query, limit: PAGE });
  const limit = extended.query === query ? extended.limit : PAGE;
  const search = useDictionarySearch(query, limit, referential);
  const inputId = useId();
  const hintId = useId();
  const language = languages.find((lang) => lang === i18n.language) ?? "en";

  useEffect(() => {
    if (query !== q) void navigate({ search: { q: query }, replace: true });
  }, [query, q, navigate]);

  if (state.status !== "ready") return null;
  const results = search.status === "done" ? search.results : null;
  const answered = search.status === "done" && search.query !== "";

  return (
    <section aria-labelledby="dictionary-title" className="max-w-3xl">
      <h1 id="dictionary-title" className="text-title">
        {t("dictionary.title")}
      </h1>
      <form
        role="search"
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label htmlFor={inputId} className="font-semibold">
          {t("dictionary.label")}
        </label>
        <p id={hintId} className="text-small text-muted">
          {t("dictionary.hint")}
        </p>
        <input
          id={inputId}
          type="search"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          aria-describedby={hintId}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className="mt-2 min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-body"
        />
      </form>
      <p role="status" className="mt-4 text-small text-muted">
        {answered &&
          (search.results.total === 0
            ? t("dictionary.noResults")
            : t("dictionary.results", { count: search.results.total }))}
      </p>
      {search.status === "failed" && (
        <p role="alert" className="mt-4 text-danger">
          {failureMessage(t, search.failure)}
        </p>
      )}
      {results !== null && results.entries.length > 0 && (
        <>
          <ol className="divide-y divide-hairline">
            {results.entries.map((entry) => (
              <ResultItem
                key={`${entry.headword}\t${entry.reading ?? ""}`}
                entry={entry}
                features={state.pack.features}
                referential={referential}
                language={language}
              />
            ))}
          </ol>
          {results.total > results.entries.length && (
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <Button
                variant="outline"
                onClick={() => {
                  setExtended({ query, limit: limit + PAGE });
                }}
              >
                {t("dictionary.more")}
              </Button>
              <p className="text-small text-muted">
                {t("dictionary.shown", { shown: results.entries.length, total: results.total })}
              </p>
            </div>
          )}
        </>
      )}
      <Credits />
    </section>
  );
};
