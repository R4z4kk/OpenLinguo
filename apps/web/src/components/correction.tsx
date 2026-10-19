import {
  err,
  type AiError,
  type AiErrorKind,
  type GlossLanguage,
  type PromptPack,
  type ReadingCheckError,
  type ReadingMismatch,
  type Result,
} from "@openlinguo/core";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";
import { AiBadge } from "@/components/ai-badge";
import { useAiNotice } from "@/components/ai-notice";
import { AiSent } from "@/components/ai-sent";
import { CardProposal } from "@/components/card-proposal";
import { pinyinSyllables, type PinyinFeatures } from "@/components/pinyin";
import { Button } from "@/components/ui/button";
import type { AiCall } from "@/data/ai-notice";
import { rememberMode, type AiConnection } from "@/data/ai-settings";
import {
  CORRECTION_CHOICES,
  correctionInput,
  diacritic,
  diffChars,
  readingSyllables,
  requestCorrection,
  type CorrectionChoice,
  type Corrections,
  type CorrectionTask,
  type SentenceCorrection,
} from "@/data/correction";
import { database } from "@/data/database";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";
import { cn } from "@/lib/utils";

type ShownError = Omit<AiError, "kind"> & { readonly kind: Exclude<AiErrorKind, "aborted"> };

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "failed"; readonly error: ShownError };

type Focus = "correct" | "cancel" | "retry";

/** Where « Correct » sends the sentences; `null` hides it. */
export type CorrectionSource = {
  readonly connection: AiConnection;
  readonly task: CorrectionTask;
};

type Options = {
  readonly feature: "challenge" | "journal";
  readonly source: CorrectionSource | null;
  readonly word: string | null;
  readonly sentences: readonly string[];
  readonly language: GlossLanguage;
  /** Beside « Correct », before the call: « Skip », « Save »… */
  readonly secondary: ReactNode;
  /** Stores the corrections, one per field; nothing is stored on an error. */
  readonly onCorrected: (corrections: Corrections) => void;
  /** « Later », after an error. */
  readonly onLater: () => void;
};

/**
 * « Correct » and its states: the first-use notice, the call that « Cancel » aborts, an error in
 * words with « Retry » and « Later ». `running`: the fields are read-only. `warning`: a mode the
 * settings could not keep, shown wherever the caller wants.
 */
export const useCorrection = ({
  feature,
  source,
  word,
  sentences,
  language,
  secondary,
  onCorrected,
  onLater,
}: Options): {
  readonly running: boolean;
  readonly controls: ReactNode;
  readonly warning: ReactNode;
} => {
  const { t } = useTranslation();
  const notice = useAiNotice();
  const sentId = useId();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [empty, setEmpty] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  /** Where focus goes once the next phase is drawn. */
  const focusNext = useRef<Focus | null>(null);
  const correctButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === null) return;
    ({ correct: correctButton, cancel: cancelButton, retry: retryButton })[target].current?.focus();
  }, [phase]);

  if (source === null) return { running: false, controls: null, warning: null };
  const { connection, task } = source;
  const provider = connection.endpoint.provider;
  const input = correctionInput(word, sentences, language);
  const call = (action: string): AiCall => ({
    provider,
    action,
    // An empty challenge still says what « Correct » would send.
    payload: {
      feature,
      input: input.sentences.length === 0 ? { ...input, sentences } : input,
    },
  });

  const run = async (): Promise<void> => {
    const abort = new AbortController();
    controller.current = abort;
    focusNext.current = "cancel";
    setPhase({ kind: "running" });
    const reply = await requestCorrection(
      connection,
      task,
      word,
      sentences,
      language,
      abort.signal,
    );
    if (controller.current !== abort) return;
    controller.current = null;
    if (!reply.ok) {
      const { kind } = reply.error;
      if (kind === "aborted") {
        focusNext.current = "correct";
        setPhase({ kind: "idle" });
      } else {
        focusNext.current = "retry";
        setPhase({ kind: "failed", error: { ...reply.error, kind } });
      }
      return;
    }
    const kept = await rememberMode(database, connection, reply.value.mode);
    setWarning(
      kept.ok ? null : t("correction.modeNotSaved", { reason: describeFailure(kept.error) }),
    );
    setPhase({ kind: "idle" });
    onCorrected(reply.value.corrections);
  };

  const start = (action: string): void => {
    const nothing = input.sentences.length === 0;
    setEmpty(nothing);
    if (!nothing) {
      notice.ask(call(action), () => {
        void run();
      });
    }
  };

  const name = t(`aiNotice.providers.${provider}`);
  const status = (
    <p role="status" className="mt-2 text-small text-muted first-letter:uppercase">
      {phase.kind === "running" &&
        t("correction.runningStatus", { provider: name, count: input.sentences.length })}
    </p>
  );
  const shown = {
    warning:
      warning === null ? null : (
        <p role="alert" className="mt-2 text-danger">
          {warning}
        </p>
      ),
  };

  if (phase.kind === "running")
    return {
      running: true,
      warning: shown.warning,
      controls: (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button aria-disabled="true">
              <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
              {t("correction.running")}
            </Button>
            <Button
              ref={cancelButton}
              variant="outline"
              onClick={() => {
                controller.current?.abort();
              }}
            >
              {t("correction.cancel")}
            </Button>
          </div>
          {status}
        </>
      ),
    };

  if (phase.kind === "failed") {
    const { error } = phase;
    const local = provider === "local" && error.kind === "network";
    const retry = t("correction.retry");
    return {
      running: false,
      warning: shown.warning,
      controls: (
        <>
          <div
            role="alert"
            className="mt-6 flex items-start gap-2 rounded-card border-2 border-danger bg-surface px-4 py-3"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-5 flex-none text-danger" />
            <div className="flex min-w-0 flex-col gap-1">
              <strong>
                {t(
                  error.kind === "invalid-response" ? "correction.unreadable" : "correction.failed",
                )}
              </strong>
              <span>
                {local
                  ? `${t("ai.errors.localNetwork")} ${t("ai.errors.localNetworkHelp", { origin: location.origin })}`
                  : t(`ai.errors.${error.kind}`, { provider: name })}{" "}
                {t("correction.intact")}
              </span>
              {error.message !== null && (
                <span className="text-small break-words text-muted">{error.message}</span>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  ref={retryButton}
                  aria-describedby={sentId}
                  onClick={() => {
                    start(retry);
                  }}
                >
                  {retry}
                </Button>
                <Button variant="ghost" onClick={onLater}>
                  {t("correction.later")}
                </Button>
              </div>
            </div>
          </div>
          <AiSent id={sentId} call={call(retry)} />
          {status}
          {notice.view}
        </>
      ),
    };
  }

  const correct = t("correction.correct");
  return {
    running: false,
    warning: shown.warning,
    controls: (
      <>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button
            ref={correctButton}
            aria-describedby={sentId}
            onClick={() => {
              start(correct);
            }}
          >
            {correct}
          </Button>
          {secondary}
        </div>
        <AiSent id={sentId} call={call(correct)} />
        {empty && (
          <p role="alert" className="mt-2 text-danger">
            {t("correction.nothingToSend")}
          </p>
        )}
        {status}
        {notice.view}
      </>
    ),
  };
};

const Inserted = ({ text }: { readonly text: string }) => {
  const { t, i18n } = useTranslation();
  return (
    <ins className="underline decoration-2 underline-offset-4">
      <span lang={i18n.language} className="sr-only">
        {t("correction.insertedBefore")}
      </span>
      {text}
      <span lang={i18n.language} className="sr-only">
        {t("correction.hiddenAfter")}
      </span>
    </ins>
  );
};

const Removed = ({ text }: { readonly text: string }) => {
  const { t, i18n } = useTranslation();
  return (
    <del className="text-muted line-through decoration-2">
      <span lang={i18n.language} className="sr-only">
        {t("correction.removedBefore")}
      </span>
      {text}
      <span lang={i18n.language} className="sr-only">
        {t("correction.hiddenAfter")}
      </span>
    </del>
  );
};

/** The AI's pinyin in tone colors; a syllable the dictionary does not give is flagged, never fixed. */
const Reading = ({
  correction,
  checkReading,
  features,
}: {
  readonly correction: SentenceCorrection;
  readonly checkReading: PromptPack["checkReading"];
  readonly features: PinyinFeatures;
}) => {
  const { t, i18n } = useTranslation();
  const { corrected, reading } = correction;
  const [checked, setChecked] = useState<Result<
    readonly ReadingMismatch[],
    ReadingCheckError
  > | null>(null);

  useEffect(() => {
    let current = true;
    checkReading(corrected, reading).then(
      (result) => {
        if (current) setChecked(result);
      },
      (error: unknown) => {
        if (current) setChecked(err({ kind: "storage-failure", message: String(error) }));
      },
    );
    return () => {
      current = false;
    };
  }, [checkReading, corrected, reading]);

  const syllables = readingSyllables(corrected, reading, checked?.ok === true ? checked.value : []);
  const shown =
    syllables === null
      ? null
      : pinyinSyllables(syllables.map(({ numbered }) => numbered).join(" "), features);
  const list = new Intl.ListFormat(i18n.language, { type: "disjunction" });
  const flags = (syllables ?? []).flatMap(({ numbered, mismatch }) =>
    mismatch === null ? [] : [{ numbered, mismatch }],
  );
  const invalid =
    shown === null || (checked?.ok === false && checked.error.kind === "invalid-reading");
  return (
    <>
      <p className="mt-2">
        <span lang="zh-Latn-pinyin" className="font-zh text-pinyin">
          {shown === null
            ? reading
            : shown.map(({ text, color }, index) => {
                const flagged = syllables?.[index]?.mismatch != null;
                return (
                  // Syllables never move: the index is a stable key.
                  <Fragment key={index}>
                    {index > 0 && " "}
                    <span
                      className={cn(
                        color,
                        flagged &&
                          "underline decoration-danger decoration-wavy decoration-[1.5px] underline-offset-4",
                      )}
                    >
                      {text}
                    </span>
                    {flagged && (
                      <span lang={i18n.language} className="sr-only">
                        {t("correction.toCheck")}
                      </span>
                    )}
                  </Fragment>
                );
              })}
        </span>
      </p>
      {invalid ? (
        <p className="mt-1 flex items-start gap-1.5 text-small text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 flex-none" />
          {t("correction.readingInvalid")}
        </p>
      ) : (
        flags.map(({ numbered, mismatch }) => {
          const values = {
            written: diacritic(numbered),
            character: corrected.slice(mismatch.start, mismatch.end),
            readings: list.format(mismatch.readings.map(diacritic)),
          };
          return (
            <p
              key={mismatch.start}
              className="mt-1 flex items-start gap-1.5 text-small text-danger"
            >
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 flex-none" />
              {mismatch.readings.length === 0
                ? t("correction.readingUnknown", values)
                : t("correction.readingFlag", values)}
            </p>
          );
        })
      )}
      {checked?.ok === false && checked.error.kind !== "invalid-reading" && (
        <p role="alert" className="mt-1 text-small text-danger">
          {checked.error.kind === "dataset-missing"
            ? t("dataImport.missing", { dataset: checked.error.dataset })
            : t("dataImport.unreadable", { message: checked.error.message })}
        </p>
      )}
    </>
  );
};

export type SentenceHeading = "h2" | "h3" | "h4";

const Corrected = ({
  heading: Heading,
  number,
  correction,
  prompts,
  features,
  acceptButton,
  onChoose,
  made,
  onMake,
}: {
  readonly heading: SentenceHeading;
  readonly number: number;
  readonly correction: SentenceCorrection;
  readonly prompts: PromptPack;
  readonly features: PinyinFeatures;
  readonly acceptButton: RefObject<HTMLButtonElement | null> | null;
  readonly onChoose: (choice: CorrectionChoice) => Promise<Result<null, ReviewLogFailure>>;
  /** The deck a card from this sentence was last made in. */
  readonly made: string | null;
  readonly onMake: (button: HTMLButtonElement) => void;
}) => {
  const { t } = useTranslation();
  const id = useId();
  const madeId = useId();
  const [failure, setFailure] = useState<string | null>(null);
  const { original, corrected, changes, meaning, choice } = correction;
  return (
    <section aria-labelledby={id} className="rounded-card border border-hairline bg-surface p-4">
      <Heading id={id} className="font-semibold">
        {t("correction.sentence", { number })}
      </Heading>
      <p lang="zh-Hans" className="mt-2 font-zh text-subtitle font-normal">
        {diffChars(original, corrected).map((part, index) =>
          part.kind === "same" ? (
            // Parts never move: the index is a stable key.
            <Fragment key={index}>{part.text}</Fragment>
          ) : part.kind === "added" ? (
            <Inserted key={index} text={part.text} />
          ) : (
            <Removed key={index} text={part.text} />
          ),
        )}
      </p>
      <Reading correction={correction} checkReading={prompts.checkReading} features={features} />
      <p className="mt-2">{meaning}</p>
      {changes.length > 0 && (
        <div className="mt-3">
          <p className="font-semibold">{t("correction.changes")}</p>
          <ul className="mt-1 flex flex-col gap-2">
            {changes.map((change, index) => (
              // Changes never move: the index is a stable key.
              <li key={index} className="flex flex-col">
                <span lang="zh-Hans" className="font-zh">
                  {change.from !== "" && <Removed text={change.from} />}
                  {change.from !== "" && change.to !== "" && <span aria-hidden="true"> → </span>}
                  {change.to !== "" && <Inserted text={change.to} />}
                </span>
                <span>{change.explanation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {CORRECTION_CHOICES.map((option) => (
          <Button
            key={option}
            ref={option === "accepted" ? acceptButton : null}
            variant={option === "accepted" ? "default" : "outline"}
            aria-describedby={id}
            aria-pressed={choice === option}
            onClick={() => {
              void onChoose(option).then((chosen) => {
                setFailure(
                  chosen.ok
                    ? null
                    : t("correction.saveFailed", { reason: describeFailure(chosen.error) }),
                );
              });
            }}
          >
            {t(option === "accepted" ? "correction.accept" : "correction.keep")}
          </Button>
        ))}
        {choice === "accepted" && (
          <Button
            variant="outline"
            aria-describedby={made === null ? id : `${id} ${madeId}`}
            onClick={(event) => {
              onMake(event.currentTarget);
            }}
          >
            {t("cardProposal.make")}
          </Button>
        )}
      </div>
      {made !== null && (
        <p id={madeId} className="mt-2 flex items-start gap-1.5 text-small">
          <Check aria-hidden="true" className="mt-0.5 size-4 flex-none" />
          {t("cardProposal.made", { deck: made })}
        </p>
      )}
      {failure !== null && (
        <p role="alert" className="mt-2 text-danger">
          {failure}
        </p>
      )}
    </section>
  );
};

/**
 * Per sentence: unchanged, or the diff (inserted characters underlined, removed ones struck
 * through, each with hidden words), the AI's pinyin and meaning, the changes and their
 * explanations, then « Accept » or « Keep mine ». Focus lands on the first « Accept ».
 */
export const CorrectionView = ({
  heading,
  corrections,
  prompts,
  features,
  onChoose,
}: {
  /** One level under the caller's title. */
  readonly heading: SentenceHeading;
  readonly corrections: Corrections;
  readonly prompts: PromptPack;
  readonly features: PinyinFeatures;
  readonly onChoose: (
    index: number,
    choice: CorrectionChoice,
  ) => Promise<Result<null, ReviewLogFailure>>;
}) => {
  const { t } = useTranslation();
  const firstAccept = useRef<HTMLButtonElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const items = corrections.flatMap((correction, index) =>
    correction === null ? [] : [{ correction, index }],
  );
  const changed = items.filter(({ correction }) => correction.corrected !== correction.original);
  const first = changed[0]?.index ?? null;
  const provenance = items[0]?.correction.provenance ?? null;
  const [proposal, setProposal] = useState<{
    readonly index: number;
    readonly correction: SentenceCorrection;
  } | null>(null);
  const [made, setMade] = useState<ReadonlyMap<number, string>>(new Map());
  /** « Make a card » that opened the proposal: focus goes back to it. */
  const opener = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    (firstAccept.current ?? summary.current)?.focus();
  }, []);

  useEffect(() => {
    if (proposal === null) opener.current?.focus();
  }, [proposal]);

  return (
    <>
      <div hidden={proposal !== null} className="mt-4 flex flex-col">
        {provenance !== null && <AiBadge provenance={provenance} />}
        <p ref={summary} tabIndex={-1} className="mt-3 rounded-control text-muted">
          {t("correction.summary", {
            review: t("correction.toReview", { count: changed.length }),
            same: t("correction.unchanged", { count: items.length - changed.length }),
          })}
        </p>
        {changed.length > 0 && (
          <p aria-hidden="true" className="mt-1 text-small text-muted">
            <span className="text-ink underline decoration-2 underline-offset-4">
              {t("correction.underlined")}
            </span>
            {t("correction.added")} ·{" "}
            <span className="text-ink line-through decoration-2">
              {t("correction.struckThrough")}
            </span>
            {t("correction.removed")}
          </p>
        )}
        <ol className="mt-4 flex flex-col gap-3">
          {items.map(({ correction, index }) => (
            <li key={index}>
              {correction.corrected === correction.original ? (
                <div className="flex items-start gap-3 rounded-card border border-hairline bg-surface px-4 py-3">
                  <Check aria-hidden="true" className="mt-1 size-5 flex-none" />
                  <span className="flex flex-col">
                    <span className="text-small text-muted">
                      {t("correction.unchangedSentence", { number: index + 1 })}
                    </span>
                    <span lang="zh-Hans" className="font-zh text-pinyin">
                      {correction.corrected}
                    </span>
                  </span>
                </div>
              ) : (
                <Corrected
                  heading={heading}
                  number={index + 1}
                  correction={correction}
                  prompts={prompts}
                  features={features}
                  acceptButton={index === first ? firstAccept : null}
                  onChoose={(choice) => onChoose(index, choice)}
                  made={made.get(index) ?? null}
                  onMake={(button) => {
                    opener.current = button;
                    setProposal({ index, correction });
                  }}
                />
              )}
            </li>
          ))}
        </ol>
      </div>
      {proposal !== null && (
        <CardProposal
          heading={heading}
          number={proposal.index + 1}
          correction={proposal.correction}
          checkReading={prompts.checkReading}
          onCancel={() => {
            setProposal(null);
          }}
          onMade={(deck) => {
            setMade(new Map(made).set(proposal.index, deck));
            setProposal(null);
          }}
        />
      )}
    </>
  );
};
