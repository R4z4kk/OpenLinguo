import {
  proficiencyFrameworks,
  type DecompositionFeature,
  type DecompositionNode,
  type DictEntry,
  type LanguagePack,
  type LookupError,
  type Result,
  type StrokeData,
} from "@openlinguo/core";
import type { ZhProficiency } from "@openlinguo/lang-zh";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Info } from "lucide-react";
import { Suspense, use, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CREDITS, Credits } from "@/components/credits";
import { DecompositionTree } from "@/components/decomposition-tree";
import { RubyWord } from "@/components/ruby-word";
import { SegmentedControl } from "@/components/segmented-control";
import { StrokeOrder } from "@/components/stroke-order";
import { useData } from "@/data/data-context";
import { groupGlosses } from "@/data/gloss-summary";
import { languages, type Language } from "@/i18n/language";

const HAN = /\p{Script=Han}/u;

type Lookup = Promise<Result<readonly DictEntry[], LookupError>>;
type Decomposed = Promise<Result<DecompositionNode, LookupError>>;
type Strokes = Promise<readonly (readonly [string, Result<StrokeData | null, LookupError>])[]>;

/** The route param, checked: the router's param types resolve to `any`. */
const wordParam = (params: unknown): string =>
  typeof params === "object" &&
  params !== null &&
  "word" in params &&
  typeof params.word === "string"
    ? params.word
    : "";

const sourceName = (source: string): string =>
  Object.entries(CREDITS).find(([id]) => id === source)?.[1].name ?? source;

const Failure = ({ failure }: { readonly failure: LookupError }) => {
  const { t } = useTranslation();
  return (
    <p role="alert" className="mt-4 text-danger">
      {failure.kind === "storage-failure"
        ? t("dataImport.unreadable", { message: failure.message })
        : t("dataImport.missing", { dataset: failure.dataset })}
    </p>
  );
};

/** Every gloss with its source; a missing interface language is said, not hidden. */
const Glosses = ({
  entry,
  language,
}: {
  readonly entry: DictEntry;
  readonly language: Language;
}) => {
  const { t } = useTranslation();
  const groups = groupGlosses(entry.glosses, language);
  return (
    <div className="mt-4 flex flex-col gap-4">
      {!groups.some((group) => group.lang === language) && (
        <p className="flex items-start gap-2 rounded-control border border-border-strong px-3 py-2 text-small">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t("word.noGlossIn", { language: t(`dictionary.glossesIn.${language}`) })}
        </p>
      )}
      {groups.map((group) => (
        <div key={group.source}>
          <h3 className="text-small text-muted">
            {t("word.glossSource", {
              source: sourceName(group.source),
              language: t(`dictionary.glossesIn.${group.lang}`),
            })}
          </h3>
          <ol lang={group.lang} className="mt-1 list-decimal pl-8">
            {group.texts.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
};

const Entries = ({
  word,
  lookup,
  pack,
  referential,
  language,
}: {
  readonly word: string;
  readonly lookup: Lookup;
  readonly pack: LanguagePack;
  readonly referential: ZhProficiency;
  readonly language: Language;
}) => {
  const { t } = useTranslation();
  const result = use(lookup);
  if (!result.ok) return <Failure failure={result.error} />;
  // The reading taught first comes first; ungraded readings keep the dictionary order.
  const entries = [...result.value].sort(
    (a, b) => (a.level ?? Number.MAX_SAFE_INTEGER) - (b.level ?? Number.MAX_SAFE_INTEGER),
  );
  const [only] = entries;
  const ruby = entries.length === 1 && only?.headword === word ? only.reading : null;
  const variants = [...new Set(entries.flatMap((entry) => entry.variants))].filter(
    (variant) => variant !== word,
  );
  return (
    <>
      <h1 id="word-title" className="mt-4">
        {ruby === null ? (
          <span lang="zh-Hans" className="font-display text-display">
            {word}
          </span>
        ) : (
          <RubyWord word={word} reading={ruby} features={pack.features} size="display" />
        )}
      </h1>
      {variants.length > 0 && (
        <p className="mt-2 text-muted">
          {t("word.traditional")}{" "}
          <span lang="zh-Hant" className="font-zh text-subtitle text-ink">
            {variants.join(" ")}
          </span>
        </p>
      )}
      {entries.length === 0 && <p className="mt-4">{t("word.notFound")}</p>}
      {entries.map((entry) => {
        const level =
          entry.level === null ? null : proficiencyFrameworks[referential][entry.level - 1];
        return (
          <section
            key={`${entry.headword}\t${entry.reading ?? ""}`}
            className={ruby === null ? "mt-6 border-t border-hairline pt-4" : "mt-6"}
          >
            {ruby === null && entry.reading !== null && (
              <h2>
                <RubyWord
                  word={entry.headword}
                  reading={entry.reading}
                  features={pack.features}
                  size="title"
                />
              </h2>
            )}
            {level != null && (
              <p className="mt-2 text-small text-muted">
                <span className="rounded-full border border-border-strong px-2 text-caption text-ink">
                  {t("dictionary.level", { level })}
                </span>{" "}
                {t(`referential.${referential}`)}
              </p>
            )}
            <Glosses entry={entry} language={language} />
          </section>
        );
      })}
    </>
  );
};

const Decomposition = ({
  tree,
  decompose,
  language,
}: {
  readonly tree: Decomposed;
  readonly decompose: DecompositionFeature["decompose"];
  readonly language: Language;
}) => {
  const result = use(tree);
  return result.ok ? (
    <DecompositionTree root={result.value} decompose={decompose} language={language} />
  ) : (
    <Failure failure={result.error} />
  );
};

const StrokeOrders = ({ strokes }: { readonly strokes: Strokes }) => {
  const { t } = useTranslation();
  const characters = use(strokes);
  const [selected, setSelected] = useState(characters[0]?.[0] ?? "");
  const name = useId();
  const shown = characters.find(([character]) => character === selected) ?? null;
  return (
    <>
      {characters.length > 1 && (
        <SegmentedControl
          legend={t("word.character")}
          name={name}
          options={characters.map(([character]) => ({
            value: character,
            label: character,
            lang: "zh-Hans",
          }))}
          value={selected}
          onChange={setSelected}
          failure={null}
        />
      )}
      {shown !== null && (
        <div className="mt-4">
          {!shown[1].ok ? (
            <Failure failure={shown[1].error} />
          ) : shown[1].value === null ? (
            <p>{t("word.noStrokes", { character: shown[0] })}</p>
          ) : (
            <StrokeOrder key={shown[0]} character={shown[0]} data={shown[1].value} />
          )}
        </div>
      )}
    </>
  );
};

const WordContent = ({
  word,
  pack,
  referential,
  language,
}: {
  readonly word: string;
  readonly pack: LanguagePack;
  readonly referential: ZhProficiency;
  readonly language: Language;
}) => {
  const { t } = useTranslation();
  const { decomposition, strokes } = pack.features;
  const characters = useMemo(
    () => [...new Set(Array.from(word))].filter((character) => HAN.test(character)),
    [word],
  );
  // Started once per word and pack, read with `use` under Suspense.
  const lookup = useMemo(() => pack.lookup(word), [pack, word]);
  const tree = useMemo(
    () =>
      decomposition === null || characters.length === 0 ? null : decomposition.decompose(word),
    [decomposition, characters, word],
  );
  const strokeData: Strokes | null = useMemo(
    () =>
      strokes === null || characters.length === 0
        ? null
        : Promise.all(
            characters.map(
              async (character) => [character, await strokes.strokesOf(character)] as const,
            ),
          ),
    [strokes, characters],
  );
  const decompositionId = useId();
  const strokesId = useId();

  return (
    <article aria-labelledby="word-title" className="max-w-3xl">
      <Link
        to="/learn/dictionary"
        search={{ q: word }}
        className="inline-flex min-h-11 items-center gap-2 text-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("dictionary.title")}
      </Link>
      <Suspense fallback={null}>
        <Entries
          word={word}
          lookup={lookup}
          pack={pack}
          referential={referential}
          language={language}
        />
      </Suspense>
      {tree !== null && decomposition !== null && (
        <section aria-labelledby={decompositionId} className="mt-10">
          <h2 id={decompositionId} className="text-subtitle">
            {t("word.decomposition")}
          </h2>
          <div className="mt-4">
            <Suspense fallback={null}>
              <Decomposition tree={tree} decompose={decomposition.decompose} language={language} />
            </Suspense>
          </div>
        </section>
      )}
      {strokeData !== null && (
        <section aria-labelledby={strokesId} className="mt-10">
          <h2 id={strokesId} className="text-subtitle">
            {t("word.strokes")}
          </h2>
          <div className="mt-4">
            <Suspense fallback={null}>
              <StrokeOrders strokes={strokeData} />
            </Suspense>
          </div>
        </section>
      )}
      <Credits
        ids={[
          "cc-cedict",
          "cfdict",
          "wiktionary-fr",
          referential,
          "makemeahanzi",
          "hanzi-writer-data",
        ]}
      />
    </article>
  );
};

/** One written form: each reading with its level and glosses, decomposition, stroke order. */
export const WordPage = () => {
  const { i18n } = useTranslation();
  const { state, referential } = useData();
  const word = wordParam(useParams({ strict: false }));
  const language = languages.find((lang) => lang === i18n.language) ?? "en";
  if (state.status !== "ready") return null;
  return (
    <WordContent
      key={word}
      word={word}
      pack={state.pack}
      referential={referential}
      language={language}
    />
  );
};
