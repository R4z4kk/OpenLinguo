import {
  proficiencyFrameworks,
  type DecompositionFeature,
  type DecompositionNode,
  type DictEntry,
  type LanguagePack,
  type LookupError,
  ok,
  type PromptPack,
  type Result,
  type StrokeData,
} from "@openlinguo/core";
import { readingKey, type ZhProficiency } from "@openlinguo/lang-zh";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Info } from "lucide-react";
import { Suspense, use, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAiTranslation } from "@/components/ai-translation";
import { CREDITS, Credits } from "@/components/credits";
import { DecompositionTree } from "@/components/decomposition-tree";
import { PlayAudio } from "@/components/play-audio";
import { RubyWord } from "@/components/ruby-word";
import { SayIt } from "@/components/say-it";
import { SegmentedControl } from "@/components/segmented-control";
import { StrokeOrder } from "@/components/stroke-order";
import { wordAudioId } from "@/data/audio-packs";
import { useData } from "@/data/data-context";
import { database } from "@/data/database";
import { describeDeckFailure, fileWord, wordDecks, type WordDecks } from "@/data/decks";
import { groupGlosses } from "@/data/gloss-summary";
import { describeFailure, guarded, type ReviewLogFailure } from "@/data/review-log";
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
  heading: Heading,
  prompts,
}: {
  readonly entry: DictEntry;
  readonly language: Language;
  /** One level below the reading's own heading, when it has one. */
  readonly heading: "h2" | "h3";
  readonly prompts: PromptPack | null;
}) => {
  const { t } = useTranslation();
  const groups = groupGlosses(entry.glosses, language);
  const container = useRef<HTMLDivElement>(null);
  const translation = useAiTranslation({
    entry,
    task: prompts?.glossTranslation ?? null,
    language,
    heading: Heading,
    container,
  });
  return (
    <div ref={container} tabIndex={-1} className="mt-4 flex flex-col gap-4">
      {translation.before}
      {!translation.translated && !groups.some((group) => group.lang === language) && (
        <p className="flex items-start gap-2 rounded-control border border-border-strong px-3 py-2 text-small">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t("word.noGlossIn", { language: t(`dictionary.glossesIn.${language}`) })}
        </p>
      )}
      {groups.map((group) => (
        <div key={group.source}>
          <Heading className="text-small text-muted">
            {t("word.glossSource", {
              source: sourceName(group.source),
              language: t(`dictionary.glossesIn.${group.lang}`),
            })}
          </Heading>
          <ol lang={group.lang} className="mt-1 list-decimal pl-8">
            {group.texts.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ol>
        </div>
      ))}
      {translation.after}
    </div>
  );
};

/** The audio pack recording of a reading, once its band is downloaded (Learn), and saying it. */
const WordAudio = ({
  entry,
  reading,
  features,
  language,
  heading,
}: {
  readonly entry: DictEntry;
  readonly reading: string;
  readonly features: LanguagePack["features"];
  readonly language: Language;
  readonly heading: "h2" | "h3";
}) => {
  const { headword } = entry;
  const { t } = useTranslation();
  const key = readingKey(reading);
  const id = key.ok ? wordAudioId(headword, key.value) : null;
  const [found, setFound] = useState<Result<boolean, ReviewLogFailure> | null>(null);
  useEffect(() => {
    if (id === null) return;
    let current = true;
    void guarded(async () =>
      ok((await database.wordAudio.where(":id").equals(id).count()) > 0),
    ).then((result) => {
      if (current) setFound(result);
    });
    return () => {
      current = false;
    };
  }, [id]);
  if (id === null || found === null) return null;
  if (!found.ok) {
    return (
      <p role="alert" className="mt-3 text-danger">
        {t("review.audioFailed", { reason: describeFailure(found.error) })}
      </p>
    );
  }
  return found.value && key.ok ? (
    <div className="mt-3">
      <PlayAudio source={{ table: "wordAudio", id }} align="start" />
      <SayIt
        headword={headword}
        readingKey={key.value}
        audioId={id}
        glosses={entry.glosses}
        features={features}
        language={language}
        heading={heading}
      />
    </div>
  ) : null;
};

/** One checkbox per personal deck: native keyboard and screen reader support. */
const DeckPicker = ({
  headword,
  reading,
  referential,
  describedBy,
}: {
  readonly headword: string;
  readonly reading: string;
  readonly referential: ZhProficiency;
  /** The heading that shows the reading. */
  readonly describedBy: string;
}) => {
  const { t } = useTranslation();
  const key = useMemo(() => readingKey(reading), [reading]);
  const [decks, setDecks] = useState<WordDecks | null>(null);
  const [failure, setFailure] = useState<string | null>(
    key.ok ? null : `${key.error.kind} ${key.error.reading}`,
  );
  const pending = useRef(false);

  useEffect(() => {
    if (!key.ok) return;
    let active = true;
    void wordDecks(database, { headword, readingKey: key.value }).then((result) => {
      if (!active) return;
      if (result.ok) setDecks(result.value);
      else setFailure(describeFailure(result.error));
    });
    return () => {
      active = false;
    };
  }, [headword, key]);

  const toggle = async (deckId: string, filed: boolean): Promise<void> => {
    if (!key.ok || pending.current) return;
    pending.current = true;
    const result = await fileWord(
      database,
      deckId,
      { headword, readingKey: key.value },
      filed,
      referential,
    );
    pending.current = false;
    if (!result.ok) {
      setFailure(describeDeckFailure(result.error));
      return;
    }
    setFailure(null);
    setDecks((current) => {
      if (current === null) return null;
      const next = new Set(current.filed);
      if (filed) next.add(deckId);
      else next.delete(deckId);
      return { ...current, filed: next };
    });
  };

  return (
    <div className="mt-4">
      {decks !== null && (
        <fieldset aria-describedby={describedBy} className="min-w-0">
          <legend className="text-small text-muted">{t("decks.fileIn")}</legend>
          <div className="flex flex-wrap gap-x-6">
            {decks.decks.map((deck) => (
              <label key={deck.id} className="flex min-h-11 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={decks.filed.has(deck.id)}
                  onChange={(event) => void toggle(deck.id, event.target.checked)}
                  className="size-5 accent-ink"
                />
                {deck.name ?? t("decks.myWords")}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {failure !== null && (
        <p role="alert" className="mt-2 text-danger">
          {t("decks.fileFailed", { reason: failure })}
        </p>
      )}
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
  const headingIds = useId();
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
      {entries.map((entry, index) => {
        const level =
          entry.level === null ? null : proficiencyFrameworks[referential][entry.level - 1];
        const titled = ruby === null && entry.reading !== null;
        const headingId = titled ? `${headingIds}-${String(index)}` : "word-title";
        return (
          <section
            key={`${entry.headword}\t${entry.reading ?? ""}`}
            className={ruby === null ? "mt-6 border-t border-hairline pt-4" : "mt-6"}
          >
            {titled && (
              <h2 id={headingId}>
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
            {entry.reading !== null && (
              <WordAudio
                entry={entry}
                reading={entry.reading}
                features={pack.features}
                language={language}
                heading={titled ? "h3" : "h2"}
              />
            )}
            {entry.reading !== null && (
              <DeckPicker
                headword={entry.headword}
                reading={entry.reading}
                referential={referential}
                describedBy={headingId}
              />
            )}
            <Glosses
              entry={entry}
              language={language}
              heading={titled ? "h3" : "h2"}
              prompts={pack.prompts}
            />
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
            <StrokeOrder
              key={shown[0]}
              character={shown[0]}
              data={shown[1].value}
              compact={false}
            />
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
