import type { PromptPack, Result } from "@openlinguo/core";
import { CircleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiBadge } from "@/components/ai-badge";
import type { SentenceHeading } from "@/components/correction";
import { Button } from "@/components/ui/button";
import {
  checkProposal,
  fileNote,
  isReady,
  proposeNote,
  type PinyinProblem,
  type ProposalCheck,
} from "@/data/card-proposal";
import { diacritic, type SentenceCorrection } from "@/data/correction";
import { database, MY_WORDS, type NoteContent } from "@/data/database";
import { describeDeckFailure, loadDecks, type Deck } from "@/data/decks";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";
import { fieldClass } from "@/shell/ai-settings";
import { cn } from "@/lib/utils";

type Field = keyof NoteContent;

const FIELDS = ["characters", "pinyin", "meaning"] as const satisfies readonly Field[];

type FieldProblem = Extract<PinyinProblem, { readonly kind: "mismatch" | "invalid-reading" }>;

/** A problem the learner fixes in the pinyin field; a dictionary that cannot be read is not one. */
const inField = (problem: PinyinProblem): problem is FieldProblem =>
  problem.kind === "mismatch" || problem.kind === "invalid-reading";

const ONLY_MY_WORDS: readonly Deck[] = [{ id: MY_WORDS, name: null }];

/**
 * The note proposed from an accepted correction: sentence, pinyin and meaning, all editable, and
 * the deck. A pinyin syllable the dictionary does not give is a field error; nothing is created
 * until it is fixed and the learner confirms.
 */
export const CardProposal = ({
  heading: Heading,
  number,
  correction,
  checkReading,
  onCancel,
  onMade,
}: {
  readonly heading: SentenceHeading;
  readonly number: number;
  readonly correction: SentenceCorrection;
  readonly checkReading: PromptPack["checkReading"];
  readonly onCancel: () => void;
  /** The note is created; `deck`: the deck's name as shown. */
  readonly onMade: (deck: string) => void;
}) => {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [content, setContent] = useState<NoteContent>(() => proposeNote(correction));
  const [check, setCheck] = useState<ProposalCheck | null>(null);
  const [decks, setDecks] = useState<Result<readonly Deck[], ReviewLogFailure> | null>(null);
  const [deck, setDeck] = useState(MY_WORDS);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const inputs = {
    characters: useRef<HTMLInputElement>(null),
    pinyin: useRef<HTMLInputElement>(null),
    meaning: useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    top.current?.focus();
    let current = true;
    void loadDecks(database).then((result) => {
      if (current) setDecks(result);
    });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    void checkProposal(content, checkReading).then((result) => {
      if (current) setCheck(result);
    });
    return () => {
      current = false;
    };
  }, [content, checkReading]);

  const listed = decks?.ok === true ? decks.value : ONLY_MY_WORDS;
  const deckName = (deckId: string): string =>
    listed.find((candidate) => candidate.id === deckId)?.name ?? t("decks.myWords");
  const list = new Intl.ListFormat(i18n.language, { type: "disjunction" });

  const problems = (field: Field): readonly string[] => {
    if (check === null) return [];
    if (field !== "pinyin")
      return check[field] === null
        ? []
        : [t(field === "characters" ? "cardProposal.sentenceEmpty" : "cardProposal.meaningEmpty")];
    const problem = check.pinyin;
    if (problem?.kind === "invalid-reading") return [t("cardProposal.readingInvalid")];
    if (problem?.kind !== "mismatch") return [];
    return problem.mismatches.map(({ written, character, readings }) =>
      t(readings.length === 0 ? "cardProposal.readingUnknown" : "cardProposal.readingFlag", {
        written: diacritic(written),
        character,
        readings: list.format(readings.map(diacritic)),
      }),
    );
  };

  const create = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const checked = await checkProposal(content, checkReading);
    setCheck(checked);
    if (!isReady(checked)) {
      setBusy(false);
      const first =
        FIELDS.find((field) =>
          field === "pinyin"
            ? checked.pinyin !== null && inField(checked.pinyin)
            : checked[field] !== null,
        ) ?? null;
      if (first !== null) inputs[first].current?.focus();
      return;
    }
    const filed = await fileNote(database, deck, content, correction.provenance, Date.now());
    setBusy(false);
    if (filed.ok) {
      onMade(deckName(deck));
      return;
    }
    setFailure(
      filed.error.kind === "already-filed"
        ? t("cardProposal.alreadyFiled", { deck: deckName(deck) })
        : t("cardProposal.failed", { reason: describeDeckFailure(filed.error) }),
    );
  };

  const input = (field: Field, label: string, lang: string | null, className: string) => {
    const shown = problems(field);
    const errorId = `${id}-${field}-error`;
    return (
      <div className="mt-4 flex flex-col gap-2">
        <label htmlFor={`${id}-${field}`} className="font-semibold">
          {label}
        </label>
        <input
          ref={inputs[field]}
          id={`${id}-${field}`}
          type="text"
          {...(lang === null ? {} : { lang })}
          autoComplete="off"
          spellCheck={false}
          value={content[field]}
          aria-invalid={shown.length > 0}
          {...(shown.length === 0 ? {} : { "aria-describedby": errorId })}
          onChange={(event) => {
            setFailure(null);
            setContent({ ...content, [field]: event.target.value });
          }}
          className={cn(fieldClass, "aria-invalid:border-2", className)}
        />
        {shown.length > 0 && (
          <div id={errorId} className="flex flex-col gap-1">
            {shown.map((message, index) => (
              // Messages follow the syllables, which never move: the index is a stable key.
              <p key={index} className="flex items-start gap-1.5 text-small text-danger">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 flex-none" />
                {message}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  };

  const lookup = check?.pinyin ?? null;
  return (
    <section aria-labelledby={`${id}-title`} className="mt-4 flex flex-col">
      <div ref={top} tabIndex={-1} className="rounded-control">
        <Heading id={`${id}-title`} className="text-subtitle">
          {t("cardProposal.title")}
        </Heading>
        <p className="mt-2 text-muted">{t("cardProposal.intro", { number })}</p>
      </div>
      <div className="mt-3 flex">
        <AiBadge provenance={correction.provenance} />
      </div>
      {input("characters", t("cardProposal.sentence"), "zh-Hans", "font-zh text-pinyin")}
      {input("pinyin", t("cardProposal.pinyin"), "zh-Latn-pinyin", "")}
      {lookup !== null && !inField(lookup) && (
        <p role="alert" className="mt-2 text-small text-danger">
          {lookup.kind === "dataset-missing"
            ? t("dataImport.missing", { dataset: lookup.dataset })
            : t("dataImport.unreadable", { message: lookup.message })}
        </p>
      )}
      {input("meaning", t("cardProposal.meaning"), null, "")}
      <div className="mt-4 flex flex-col gap-2">
        <label htmlFor={`${id}-deck`} className="font-semibold">
          {t("cardProposal.deck")}
        </label>
        <select
          id={`${id}-deck`}
          value={deck}
          onChange={(event) => {
            setFailure(null);
            setDeck(event.currentTarget.value);
          }}
          className={fieldClass}
        >
          {listed.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name ?? t("decks.myWords")}
            </option>
          ))}
        </select>
      </div>
      {decks?.ok === false && (
        <p role="alert" className="mt-2 text-small text-danger">
          {t("cardProposal.decksFailed", { reason: describeFailure(decks.error) })}
        </p>
      )}
      <p id={`${id}-cards`} className="mt-2 text-small text-muted">
        {t("cardProposal.cards")}
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button aria-describedby={`${id}-cards`} aria-disabled={busy} onClick={() => void create()}>
          {t("cardProposal.confirm")}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t("cardProposal.cancel")}
        </Button>
      </div>
      {failure !== null && (
        <p role="alert" className="mt-2 text-danger">
          {failure}
        </p>
      )}
    </section>
  );
};
