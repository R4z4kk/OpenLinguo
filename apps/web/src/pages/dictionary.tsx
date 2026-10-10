import {
  proficiencyFrameworks,
  type DictEntry,
  type LanguageFeatures,
  type LookupError,
} from "@openlinguo/core";
import type { ZhProficiency } from "@openlinguo/lang-zh";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Credits } from "@/components/credits";
import { GlossSummary } from "@/components/gloss-summary";
import { Pinyin } from "@/components/pinyin";
import { Button } from "@/components/ui/button";
import { useData } from "@/data/data-context";
import { database } from "@/data/database";
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
    <li className="relative py-4">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* The whole row opens the word; tone colors stay on `bg` (no hover background). */}
        <Link
          to="/learn/dictionary/$word"
          params={{ word: entry.headword }}
          lang="zh-Hans"
          className="font-zh text-subtitle after:absolute after:inset-0 hover:underline"
        >
          {entry.headword}
        </Link>
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
      <GlossSummary glosses={entry.glosses} language={language} className="mt-1" />
    </li>
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
      <Credits ids={["cc-cedict", "cfdict", "wiktionary-fr", "wordfreq"]} />
    </section>
  );
};
