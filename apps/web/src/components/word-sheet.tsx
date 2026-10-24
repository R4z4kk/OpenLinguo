import {
  ok,
  subjectId,
  type AnnotatedToken,
  type DictEntry,
  type KnownWords,
  type LanguagePack,
  type LookupError,
  type ReadingChoices,
  type Result,
  type WordKey,
} from "@openlinguo/core";
import { readingKey } from "@openlinguo/lang-zh";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GlossSummary } from "@/components/gloss-summary";
import { Pinyin } from "@/components/pinyin";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useData } from "@/data/data-context";
import { database, MY_WORDS } from "@/data/database";
import {
  describeDeckFailure,
  fileWord,
  loadDecks,
  type Deck,
  type DeckFailure,
} from "@/data/decks";
import type { ReviewLogFailure } from "@/data/review-log";
import { knownPercent, type Measure } from "@/data/text-coverage";
import {
  chooseReading,
  describeSheetFailure,
  isMarked,
  setKnownMark,
  type WordSheetFailure,
} from "@/data/word-sheet";
import { languages } from "@/i18n/language";
import { cn } from "@/lib/utils";
import { fieldClass } from "@/shell/ai-settings";

/** What an action changed, for the reader to follow. */
export type SheetChange =
  | { readonly kind: "choice"; readonly choices: ReadingChoices }
  | { readonly kind: "known" | "forgotten" }
  | { readonly kind: "filed"; readonly deck: string };

type Props = {
  readonly token: AnnotatedToken;
  readonly textId: string;
  readonly choices: ReadingChoices;
  readonly known: KnownWords;
  readonly measure: Measure;
  readonly pack: LanguagePack;
  /** Applies a change to the reader, which fails if the known words cannot be read again. */
  readonly onChange: (change: SheetChange) => Promise<Result<null, ReviewLogFailure>>;
  readonly onClose: () => void;
};

type Failure = WordSheetFailure | DeckFailure;

const describe = (failure: Failure): string =>
  failure.kind === "unknown-text" ? describeSheetFailure(failure) : describeDeckFailure(failure);

const ACTION_CLASS = "w-full sm:w-auto aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/** The sheet of a word of the text: its readings, glosses, and what the learner can do with it. */
export const WordSheet = ({
  token,
  textId,
  choices,
  known,
  measure,
  pack,
  onChange,
  onClose,
}: Props) => {
  const { t, i18n } = useTranslation();
  const { referential } = useData();
  const ids = useId();
  const language = languages.find((lang) => lang === i18n.language) ?? "en";
  const { readings } = token;
  const chosen = choices[token.start];
  const reading =
    readings.length === 1
      ? (readings[0] ?? null)
      : chosen != null && readings.includes(chosen)
        ? chosen
        : null;
  const waiting = readings.length > 1 && reading === null;
  const key = reading === null ? null : readingKey(reading);
  const keyValue = key?.ok === true ? key.value : null;
  const word: WordKey | null =
    keyValue === null ? null : { headword: token.text, readingKey: keyValue };
  const learning = word !== null && known.words.get(subjectId(word)) === "learning";

  const [entries, setEntries] = useState<Result<readonly DictEntry[], LookupError> | null>(null);
  const [marked, setMarked] = useState<{ readonly key: string; readonly value: boolean } | null>(
    null,
  );
  const [decks, setDecks] = useState<readonly Deck[]>([{ id: MY_WORDS, name: null }]);
  const [deckId, setDeckId] = useState(MY_WORDS);
  const [done, setDone] = useState<SheetChange | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    void pack.lookup(token.text).then((result) => {
      if (active) setEntries(result);
    });
    return () => {
      active = false;
    };
  }, [pack, token.text]);

  useEffect(() => {
    let active = true;
    void loadDecks(database).then((result) => {
      if (!active) return;
      if (result.ok) setDecks(result.value);
      else setFailure(describe(result.error));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (keyValue === null) return;
    let active = true;
    void isMarked(database, { headword: token.text, readingKey: keyValue }).then((result) => {
      if (!active) return;
      if (result.ok) setMarked({ key: keyValue, value: result.value });
      else setFailure(describe(result.error));
    });
    return () => {
      active = false;
    };
  }, [token.text, keyValue]);

  const run = async (write: () => Promise<Result<SheetChange, Failure>>): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    const written = await write();
    const applied = written.ok ? await onChange(written.value) : written;
    pending.current = false;
    if (!applied.ok) {
      setFailure(describe(applied.error));
      return;
    }
    setFailure(null);
    if (written.ok) setDone(written.value);
  };

  const choose = (picked: string): Promise<void> =>
    run(async () => {
      const result = await chooseReading(database, textId, token.start, picked);
      return result.ok ? ok({ kind: "choice", choices: result.value }) : result;
    });

  const toggleKnown = (): Promise<void> => {
    if (word === null || marked?.key !== keyValue) return Promise.resolve();
    const next = !marked.value;
    return run(async () => {
      const result = await setKnownMark(database, word, next, Date.now());
      if (!result.ok) return result;
      setMarked({ key: word.readingKey, value: next });
      return ok({ kind: next ? "known" : "forgotten" });
    });
  };

  const file = (): Promise<void> => {
    if (word === null) return Promise.resolve();
    const name = decks.find(({ id }) => id === deckId)?.name ?? t("decks.myWords");
    return run(async () => {
      const result = await fileWord(database, deckId, word, true, referential);
      return result.ok ? ok({ kind: "filed", deck: name }) : result;
    });
  };

  const entriesOf = (picked: string): readonly DictEntry[] =>
    entries?.ok === true ? entries.value.filter(({ reading: shown }) => shown === picked) : [];
  const level = reading === null ? null : (entriesOf(reading)[0]?.level ?? null);
  const percent = measure.total === 0 ? 0 : knownPercent(measure);
  const status =
    done === null
      ? ""
      : `${
          done.kind === "filed"
            ? t("wordSheet.done.filed", { deck: done.deck })
            : t(`wordSheet.done.${done.kind}`)
        } ${t("wordSheet.coverage", {
          percent: new Intl.NumberFormat(i18n.language, { style: "percent" }).format(percent / 100),
        })}`;
  const hintId = `${ids}-hint`;
  const isMarkedNow = marked?.key === keyValue && marked.value;

  return (
    <Dialog
      sheet={{ closeLabel: t("wordSheet.close") }}
      onClose={onClose}
      title={
        <span lang="zh-Hans" className="font-zh">
          {token.text}
        </span>
      }
      description={
        reading !== null ? (
          <>
            <Pinyin reading={reading} features={pack.features} className="text-pinyin" />
            {level !== null && (
              <>
                {" "}
                <span className="rounded-full border border-border-strong px-2 text-caption">
                  {t("dictionary.level", { level })}
                </span>{" "}
                <span className="text-small text-muted">{t(`referential.${referential}`)}</span>
              </>
            )}
          </>
        ) : waiting ? (
          t("wordSheet.chooseReading")
        ) : (
          t("wordSheet.notInDictionary")
        )
      }
    >
      {() => (
        <>
          {entries?.ok === false && (
            <p role="alert" className="mt-3 text-danger">
              {entries.error.kind === "storage-failure"
                ? t("dataImport.unreadable", { message: entries.error.message })
                : t("dataImport.missing", { dataset: entries.error.dataset })}
            </p>
          )}
          {readings.length > 1 ? (
            <fieldset className="mt-4 min-w-0">
              <legend className="text-small text-muted">{t("wordSheet.readings")}</legend>
              <div className="mt-1 flex flex-col gap-2">
                {readings.map((candidate, index) => (
                  <div
                    key={candidate}
                    className={cn(
                      "relative rounded-control border border-border-strong p-3",
                      reading === candidate && "ring-2 ring-ink",
                    )}
                  >
                    <label className="flex min-h-6 cursor-pointer items-center gap-3 after:absolute after:inset-0 after:content-['']">
                      <input
                        type="radio"
                        name={`${ids}-reading`}
                        checked={reading === candidate}
                        aria-describedby={`${ids}-gloss-${String(index)}`}
                        onChange={() => void choose(candidate)}
                        className="size-5 accent-ink"
                      />
                      <Pinyin
                        reading={candidate}
                        features={pack.features}
                        className="text-pinyin"
                      />
                    </label>
                    <div id={`${ids}-gloss-${String(index)}`} className="mt-1 pl-8">
                      <GlossSummary
                        glosses={entriesOf(candidate).flatMap((entry) => entry.glosses)}
                        language={language}
                        className={null}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
          ) : (
            reading !== null && (
              <div className="mt-3">
                <GlossSummary
                  glosses={entriesOf(reading).flatMap((entry) => entry.glosses)}
                  language={language}
                  className="line-clamp-none"
                />
              </div>
            )
          )}
          {readings.length > 0 && (
            <div className="mt-4 flex flex-col gap-3">
              {learning ? (
                <p>{t("wordSheet.learning")}</p>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex flex-col gap-1 sm:w-56">
                    <label htmlFor={`${ids}-deck`} className="text-small text-muted">
                      {t("wordSheet.deck")}
                    </label>
                    <select
                      id={`${ids}-deck`}
                      value={deckId}
                      onChange={(event) => {
                        setDeckId(event.currentTarget.value);
                      }}
                      className={fieldClass}
                    >
                      {decks.map((deck) => (
                        <option key={deck.id} value={deck.id}>
                          {deck.name ?? t("decks.myWords")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    variant="outline"
                    aria-disabled={waiting}
                    {...(waiting ? { "aria-describedby": hintId } : {})}
                    onClick={() => {
                      if (!waiting) void file();
                    }}
                    className={ACTION_CLASS}
                  >
                    {t("wordSheet.add")}
                  </Button>
                </div>
              )}
              <Button
                variant="outline"
                aria-disabled={waiting}
                {...(waiting ? { "aria-describedby": hintId } : {})}
                onClick={() => {
                  if (!waiting) void toggleKnown();
                }}
                className={cn(ACTION_CLASS, "sm:self-start")}
              >
                {isMarkedNow ? t("wordSheet.forgotten") : t("wordSheet.known")}
              </Button>
              {waiting && (
                <p id={hintId} className="text-small text-muted">
                  {t("wordSheet.chooseFirst")}
                </p>
              )}
            </div>
          )}
          {key?.ok === false && (
            <p role="alert" className="mt-3 text-danger">
              {t("wordSheet.failed", { reason: `${key.error.kind} ${key.error.reading}` })}
            </p>
          )}
          {failure !== null && (
            <p role="alert" className="mt-3 text-danger">
              {t("wordSheet.failed", { reason: failure })}
            </p>
          )}
          <p role="status" className="mt-3 min-h-6 text-small">
            {status}
          </p>
          {readings.length > 0 && (
            <Link
              to="/learn/dictionary/$word"
              params={{ word: token.text }}
              className="mt-1 inline-flex min-h-11 items-center underline"
            >
              {t("wordSheet.wordPage")}
            </Link>
          )}
        </>
      )}
    </Dialog>
  );
};
