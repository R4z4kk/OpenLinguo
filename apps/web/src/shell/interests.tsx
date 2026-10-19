import {
  chat,
  ok,
  proficiencyFrameworks,
  type AiProvenance,
  type PromptTask,
  type Result,
  type VocabularyAnswer,
  type VocabularyInput,
} from "@openlinguo/core";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiBadge } from "@/components/ai-badge";
import { useAiNotice } from "@/components/ai-notice";
import { AiSent } from "@/components/ai-sent";
import { GlossSummary } from "@/components/gloss-summary";
import { Pinyin, type PinyinFeatures } from "@/components/pinyin";
import { Button } from "@/components/ui/button";
import type { AiCall } from "@/data/ai-notice";
import { loadAiConnection, rememberMode, type AiConnection } from "@/data/ai-settings";
import { useData } from "@/data/data-context";
import { database, MY_WORDS } from "@/data/database";
import {
  deckCounts,
  describeDeckFailure,
  entryId,
  fileWords,
  loadDecks,
  localNow,
  type Deck,
} from "@/data/decks";
import {
  checkSuggestions,
  learningBand,
  loadInterests,
  NO_INTERESTS,
  NOTE_MAX,
  saveInterests,
  SUGGESTION_COUNT,
  THEMES,
  type Interests,
  type Suggestions,
} from "@/data/interests";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";
import { DEFAULT_LANGUAGE, languages } from "@/i18n/language";
import { AiFailure, fieldClass, type ShownError } from "@/shell/ai-settings";

const storage = (): Storage => localStorage;

type Vocabulary = PromptTask<VocabularyInput, VocabularyAnswer>;

type Found = Suggestions & { readonly provenance: AiProvenance };

type Focus = "theme" | "cancel" | "suggest" | "word" | "heading";

type Loaded<T> = Result<T, ReviewLogFailure> | null;

/** Profile › Interests: themes and a short note, and dictionary words an AI picks from them. */
export const InterestsSection = ({
  vocabulary,
  features,
  aiVersion,
}: {
  readonly vocabulary: Vocabulary;
  readonly features: PinyinFeatures;
  /** Changes when the AI settings are saved. */
  readonly aiVersion: number;
}) => {
  const { t, i18n } = useTranslation();
  const { referential } = useData();
  const language = languages.find((code) => code === i18n.language) ?? DEFAULT_LANGUAGE;
  const notice = useAiNotice();
  const [loaded] = useState(() => loadInterests(storage));
  const [interests, setInterests] = useState<Interests>(loaded.ok ? loaded.value : NO_INTERESTS);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const [connection, setConnection] = useState<Loaded<AiConnection | null>>(null);
  const [band, setBand] = useState<Loaded<number>>(null);
  const [decks, setDecks] = useState<Loaded<readonly Deck[]>>(null);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<ShownError | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [deck, setDeck] = useState(MY_WORDS);
  const [added, setAdded] = useState<{ readonly count: number; readonly deck: string } | null>(
    null,
  );
  const controller = useRef<AbortController | null>(null);
  const focus = useRef<Focus | null>(null);
  const themes = useRef<HTMLFieldSetElement>(null);
  const words = useRef<HTMLFieldSetElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const suggestButtonRef = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();

  useEffect(() => {
    let current = true;
    void loadAiConnection(database).then((result) => {
      if (current) setConnection(result);
    });
    return () => {
      current = false;
    };
  }, [aiVersion]);

  useEffect(() => {
    let current = true;
    void Promise.all([deckCounts(database, referential, localNow()), loadDecks(database)]).then(
      ([counts, listed]) => {
        if (!current) return;
        setBand(counts.ok ? ok(learningBand(counts.value.bands)) : counts);
        setDecks(listed);
      },
    );
    return () => {
      current = false;
    };
  }, [referential]);

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    const target = focus.current;
    if (target === null) return;
    focus.current = null;
    const element = {
      theme: themes.current?.querySelector("input"),
      word: words.current?.querySelector("input"),
      cancel: cancelButton.current,
      suggest: suggestButtonRef.current,
      heading: heading.current,
    }[target];
    element?.focus();
  });

  const update = (next: Interests): void => {
    setInterests(next);
    const saved = saveInterests(storage, next);
    setSaveFailure(saved.ok ? null : saved.error);
  };

  const link = connection?.ok === true ? connection.value : null;
  const level = band?.ok === true ? band.value : null;
  const bandName =
    level === null
      ? ""
      : t("dictionary.level", {
          level: proficiencyFrameworks[referential][level - 1] ?? String(level),
        });
  const request: VocabularyInput | null =
    level === null
      ? null
      : {
          themes: interests.themes.map((theme) => t(`interests.theme.${theme}`)),
          note: interests.note.trim(),
          level,
          count: SUGGESTION_COUNT,
        };

  const suggest = async (to: AiConnection, input: VocabularyInput): Promise<void> => {
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setFailure(null);
    setProblem(null);
    setAdded(null);
    focus.current = "cancel";
    const answer = await chat({
      endpoint: to.endpoint,
      model: to.model,
      messages: vocabulary.messages(input),
      schema: vocabulary.schema(input),
      mode: to.mode,
      signal: abort.signal,
    });
    if (controller.current !== abort) return;
    controller.current = null;
    if (!answer.ok) {
      setRunning(false);
      const { error } = answer;
      const { kind } = error;
      if (kind !== "aborted") setFailure({ ...error, kind });
      focus.current = "suggest";
      return;
    }
    const createdAt = new Date().toISOString();
    const remembered = await rememberMode(database, to, answer.value.mode);
    const checked = await checkSuggestions(database, answer.value.value.headwords, referential);
    setRunning(false);
    if (!checked.ok) {
      setProblem(t("interests.checkFailed", { reason: describeFailure(checked.error) }));
      focus.current = "suggest";
      return;
    }
    if (!remembered.ok) {
      setProblem(t("interests.modeNotSaved", { reason: describeFailure(remembered.error) }));
    }
    setFound({
      ...checked.value,
      provenance: {
        origin: "ai",
        provider: to.endpoint.provider,
        model: to.model,
        promptVersion: vocabulary.id,
        createdAt,
      },
    });
    setTicked(new Set(checked.value.words.map(({ word }) => entryId(word))));
    focus.current = checked.value.words.length > 0 ? "word" : "heading";
  };

  const add = async (shown: Found, listed: readonly Deck[]): Promise<void> => {
    const words = shown.words.filter(({ word }) => ticked.has(entryId(word)));
    setAdded(null);
    setProblem(null);
    const filed = await fileWords(
      database,
      deck,
      words.map(({ word }) => word),
    );
    if (!filed.ok) {
      setProblem(t("interests.addFailed", { reason: describeDeckFailure(filed.error) }));
      return;
    }
    setFound({ ...shown, words: shown.words.filter((word) => !words.includes(word)) });
    setTicked(new Set());
    setAdded({
      count: words.length,
      deck: listed.find((candidate) => candidate.id === deck)?.name ?? t("decks.myWords"),
    });
    focus.current = "suggest";
  };

  const suggestButton = (action: string, variant: "default" | "outline") => {
    if (connection?.ok === true && link === null) {
      return (
        <p className="mt-6 text-muted">
          {t("interests.noProvider")}{" "}
          <a href="#ai" className="underline underline-offset-3">
            {t("interests.toSettings")}
          </a>
        </p>
      );
    }
    if (link === null || request === null) return null;
    const call: AiCall = {
      provider: link.endpoint.provider,
      action,
      payload: { feature: "interests", input: request, band: bandName },
    };
    return (
      <>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {found !== null && found.words.length > 0 && decks?.ok === true && (
            <Button disabled={ticked.size === 0} onClick={() => void add(found, decks.value)}>
              {t("interests.add", { count: ticked.size })}
            </Button>
          )}
          <Button
            ref={suggestButtonRef}
            variant={variant}
            aria-describedby={`${id}-sent`}
            aria-disabled={running}
            onClick={() => {
              if (!running) notice.ask(call, () => void suggest(link, request));
            }}
          >
            {running ? t("interests.suggesting") : action}
          </Button>
          {running && (
            <Button
              ref={cancelButton}
              variant="outline"
              onClick={() => controller.current?.abort()}
            >
              {t("interests.cancel")}
            </Button>
          )}
        </div>
        <AiSent id={`${id}-sent`} call={call} />
      </>
    );
  };

  const unreadable = band?.ok === false ? band.error : decks?.ok === false ? decks.error : null;
  const note = interests.note.trim();
  const summary = [
    interests.themes.map((theme) => t(`interests.theme.${theme}`)).join(", "),
    note === "" ? "" : t("interests.quoted", { note }),
  ].filter((part) => part !== "");

  return (
    <section aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="mt-8 text-subtitle">
        {t("interests.title")}
      </h2>
      {!loaded.ok && (
        <p role="alert" className="mt-4 text-danger">
          {t("interests.loadFailed", { reason: loaded.error })}
        </p>
      )}
      {found === null ? (
        <>
          <p className="mt-2 text-muted">{t("interests.intro")}</p>
          <fieldset ref={themes} className="mt-6 min-w-0">
            <legend className="font-semibold">{t("interests.themes")}</legend>
            <div className="mt-2 grid grid-cols-2 gap-x-3 lg:grid-cols-3">
              {THEMES.map((theme) => (
                <label key={theme} className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={interests.themes.includes(theme)}
                    onChange={(event) => {
                      const { checked } = event.currentTarget;
                      update({
                        ...interests,
                        themes: THEMES.filter((other) =>
                          other === theme ? checked : interests.themes.includes(other),
                        ),
                      });
                    }}
                    className="size-5 flex-none accent-ink"
                  />
                  {t(`interests.theme.${theme}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 flex flex-col gap-2">
            <label htmlFor={`${id}-note`} className="font-semibold">
              {t("interests.note")}
            </label>
            <input
              id={`${id}-note`}
              type="text"
              maxLength={NOTE_MAX}
              aria-describedby={`${id}-note-help`}
              value={interests.note}
              onChange={(event) => {
                update({ ...interests, note: event.currentTarget.value });
              }}
              className={fieldClass}
            />
            <p id={`${id}-note-help`} className="text-small text-muted">
              {t("interests.noteHelp", { max: NOTE_MAX })}
            </p>
          </div>
          {saveFailure !== null && (
            <p role="alert" className="mt-4 text-danger">
              {t("interests.saveFailed", { reason: saveFailure })}
            </p>
          )}
          {suggestButton(t("interests.suggest"), "default")}
        </>
      ) : (
        <>
          <div className="mt-4 flex items-center justify-between gap-3 rounded-card border border-hairline bg-surface py-2 pr-2 pl-4">
            <p>{summary.length === 0 ? t("interests.nothing") : summary.join(" · ")}</p>
            <Button
              variant="ghost"
              aria-label={t("interests.editLabel")}
              onClick={() => {
                setFound(null);
                setAdded(null);
                setProblem(null);
                focus.current = "theme";
              }}
            >
              {t("interests.edit")}
            </Button>
          </div>
          <section aria-labelledby={`${id}-words`} className="mt-6 flex flex-col">
            <div className="flex flex-wrap items-center gap-3">
              <h3 ref={heading} id={`${id}-words`} tabIndex={-1} className="font-semibold">
                {t("interests.suggestions")}
              </h3>
              <AiBadge provenance={found.provenance} />
            </div>
            {found.words.length === 0 ? (
              <p className="mt-3">{t("interests.none")}</p>
            ) : (
              <>
                <p className="mt-2 text-small text-muted">{t("interests.fromDictionary")}</p>
                <fieldset ref={words} className="mt-3 flex min-w-0 flex-col gap-1">
                  <legend className="sr-only">{t("interests.words")}</legend>
                  {found.words.map(({ word, entry }) => {
                    const key = entryId(word);
                    const wordLevel =
                      entry.level === null
                        ? null
                        : (proficiencyFrameworks[referential][entry.level - 1] ?? null);
                    return (
                      <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={ticked.has(key)}
                          onChange={(event) => {
                            const { checked } = event.currentTarget;
                            setTicked((before) =>
                              checked
                                ? new Set([...before, key])
                                : new Set([...before].filter((other) => other !== key)),
                            );
                          }}
                          className="size-5 flex-none accent-ink"
                        />
                        <span className="flex min-w-0 flex-col">
                          <span className="flex flex-wrap items-baseline gap-x-2.5">
                            <span lang="zh-Hans" className="font-zh text-subtitle">
                              {entry.headword}
                            </span>
                            {entry.reading !== null && (
                              <Pinyin
                                reading={entry.reading}
                                features={features}
                                className={null}
                              />
                            )}
                            {wordLevel !== null && (
                              <span className="rounded-full border border-border-strong px-2 text-caption font-semibold">
                                {t("dictionary.level", { level: wordLevel })}
                              </span>
                            )}
                          </span>
                          <GlossSummary
                            glosses={entry.glosses}
                            language={language}
                            className={null}
                          />
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              </>
            )}
            <p className="mt-2 text-small text-muted">
              {t("interests.dropped", { count: found.dropped })}
            </p>
            {found.words.length > 0 && decks?.ok === true && (
              <div className="mt-4 flex flex-col gap-2">
                <label htmlFor={`${id}-deck`} className="font-semibold">
                  {t("interests.deck")}
                </label>
                <select
                  id={`${id}-deck`}
                  aria-describedby={`${id}-deck-help`}
                  value={deck}
                  onChange={(event) => {
                    setDeck(event.currentTarget.value);
                  }}
                  className={fieldClass}
                >
                  {decks.value.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name ?? t("decks.myWords")}
                    </option>
                  ))}
                </select>
                <p id={`${id}-deck-help`} className="text-small text-muted">
                  {t("interests.deckHelp")}
                </p>
              </div>
            )}
            <p role="status" className="mt-3 text-small">
              {added !== null && t("interests.added", added)}
            </p>
            {suggestButton(t("interests.more"), "outline")}
          </section>
        </>
      )}
      {connection?.ok === false && (
        <p role="alert" className="mt-4 text-danger">
          {t("ai.loadFailed", { reason: describeFailure(connection.error) })}
        </p>
      )}
      {unreadable !== null && (
        <p role="alert" className="mt-4 text-danger">
          {t("interests.decksFailed", { reason: describeFailure(unreadable) })}
        </p>
      )}
      {failure !== null && link !== null && (
        <AiFailure provider={link.endpoint.provider} error={failure} />
      )}
      {problem !== null && (
        <p role="alert" className="mt-4 text-danger">
          {problem}
        </p>
      )}
      {notice.view}
    </section>
  );
};
