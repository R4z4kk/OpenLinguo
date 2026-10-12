import { CardType, type Result } from "@openlinguo/core";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { Upload } from "lucide-react";
import {
  Suspense,
  use,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { NameField } from "@/components/name-field";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  audioBytes,
  deviceOffset,
  freeSpace,
  guessCards,
  guessMapping,
  historyReviews,
  importPlan,
  isQuotaShort,
  loadCards,
  loadMapping,
  noteText,
  planHistory,
  planImport,
  ROLES,
  saveMappings,
  type AnkiImportFailure,
  type CardMapping,
  type FieldMapping,
  type ImportPlan,
  type PlannedReview,
  type Role,
} from "@/data/anki-import";
import {
  readPackage,
  type AnkiFailure,
  type AnkiNoteType,
  type AnkiPackage,
} from "@/data/anki-package";
import { currentSetting, DAILY_GOAL } from "@/data/daily-goal";
import { database } from "@/data/database";
import { DECK_NAME_MAX, describeDeckFailure } from "@/data/decks";
import { browserStorage } from "@/data/persistence";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";

const storage = (): Storage => localStorage;
const PREVIEW_NOTES = 3;
const SHOWN_NAMES = 5;
const MEGABYTE = 1_000_000;

type Loaded = { readonly ankiPackage: AnkiPackage; readonly fileName: string };

const formatSize = (bytes: number, language: string): string =>
  new Intl.NumberFormat(language, {
    style: "unit",
    unit: bytes >= MEGABYTE ? "megabyte" : "kilobyte",
    maximumFractionDigits: 1,
  }).format(bytes / (bytes >= MEGABYTE ? MEGABYTE : 1000));

const names = (list: readonly string[]): string =>
  list.length > SHOWN_NAMES ? `${list.slice(0, SHOWN_NAMES).join(", ")}…` : list.join(", ");

const packageFailure = (t: TFunction, failure: AnkiFailure): string => {
  switch (failure.kind) {
    case "not-zip":
    case "no-collection":
      return t("ankiImport.notApkg");
    case "too-new":
      return t("ankiImport.tooNew", { version: failure.version });
    case "zip64":
      return t("ankiImport.tooLarge");
    case "read":
      return t("ankiImport.readFailed", { reason: failure.message });
    case "not-sqlite":
      return t("ankiImport.damaged", { reason: failure.kind });
    case "missing-table":
      return t("ankiImport.damaged", { reason: `${failure.kind} ${failure.table}` });
    case "corrupt-zip":
    case "corrupt-database":
    case "corrupt-package":
      return t("ankiImport.damaged", { reason: failure.detail });
  }
};

const PACKAGE_FAILURES: ReadonlySet<string> = new Set<AnkiFailure["kind"]>([
  "not-zip",
  "zip64",
  "corrupt-zip",
  "read",
  "not-sqlite",
  "corrupt-database",
  "missing-table",
  "too-new",
  "no-collection",
  "corrupt-package",
]);

const isPackageFailure = (failure: AnkiImportFailure): failure is AnkiFailure =>
  PACKAGE_FAILURES.has(failure.kind);

const importFailure = (t: TFunction, failure: AnkiImportFailure): string => {
  if (failure.kind === "deck-name")
    return t(`decks.nameProblem.${failure.problem}`, { max: DECK_NAME_MAX });
  return isPackageFailure(failure)
    ? packageFailure(t, failure)
    : t("ankiImport.importFailed", { reason: describeDeckFailure(failure) });
};

const RoleSelect = ({
  role,
  noteType,
  value,
  onChange,
}: {
  readonly role: Role;
  readonly noteType: AnkiNoteType;
  readonly value: number | null;
  readonly onChange: (value: number | null) => void;
}) => {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="font-semibold">
        {t(`ankiImport.roles.${role}`)}
      </label>
      <select
        id={id}
        value={value === null ? "" : String(value)}
        onChange={(event) => {
          onChange(event.target.value === "" ? null : Number(event.target.value));
        }}
        className="mt-2 min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-body"
      >
        <option value="">
          {t(role === "characters" ? "ankiImport.leftOut" : "ankiImport.notUsed")}
        </option>
        {noteType.fields.map((field, index) => (
          <option key={field} value={index}>
            {field}
          </option>
        ))}
      </select>
    </div>
  );
};

/** The template whose Anki cards give a card type its history; the other type's is not offered. */
const CardSelect = ({
  type,
  noteType,
  cards,
  onChange,
}: {
  readonly type: CardType;
  readonly noteType: AnkiNoteType;
  readonly cards: CardMapping;
  readonly onChange: (cards: CardMapping) => void;
}) => {
  const { t } = useTranslation();
  const id = useId();
  const value = cards[type];
  const taken = cards[type === "recognition" ? "recall" : "recognition"];
  return (
    <div>
      <label htmlFor={id} className="font-semibold">
        {t(`ankiImport.cards.${type}`)}
      </label>
      <select
        id={id}
        value={value === null ? "" : String(value)}
        onChange={(event) => {
          const index = event.target.value === "" ? null : Number(event.target.value);
          onChange({ ...cards, [type]: index });
        }}
        className="mt-2 min-h-11 w-full rounded-control border border-border-strong bg-surface px-3 text-body"
      >
        <option value="">{t("ankiImport.noHistory")}</option>
        {noteType.templates.map((template, index) =>
          index === taken ? null : (
            <option key={index} value={index}>
              {template.name}
            </option>
          ),
        )}
      </select>
    </div>
  );
};

const NoteTypeMapping = ({
  noteType,
  ankiPackage,
  mapping,
  onChange,
  cards,
  onCards,
}: {
  readonly noteType: AnkiNoteType;
  readonly ankiPackage: AnkiPackage;
  readonly mapping: FieldMapping;
  readonly onChange: (mapping: FieldMapping) => void;
  /** `null` when the review history is not imported. */
  readonly cards: CardMapping | null;
  readonly onCards: (cards: CardMapping) => void;
}) => {
  const { t } = useTranslation();
  const headingId = useId();
  const notes = ankiPackage.notes.filter((note) => note.noteTypeId === noteType.id);
  const preview = notes.slice(0, PREVIEW_NOTES).map((note) => noteText(note.fields, mapping));
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2 id={headingId} className="text-subtitle">
        {t("ankiImport.noteType", { name: noteType.name })}
      </h2>
      <p className="mt-1 text-muted">{t("ankiImport.noteCount", { count: notes.length })}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {ROLES.map((role) => (
          <RoleSelect
            key={role}
            role={role}
            noteType={noteType}
            value={mapping[role]}
            onChange={(value) => {
              onChange({ ...mapping, [role]: value });
            }}
          />
        ))}
        {cards !== null &&
          mapping.characters !== null &&
          CardType.options.map((type) => (
            <CardSelect
              key={type}
              type={type}
              noteType={noteType}
              cards={cards}
              onChange={onCards}
            />
          ))}
      </div>
      {mapping.characters !== null && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-small">
            <caption className="text-left font-semibold">{t("ankiImport.preview")}</caption>
            <thead>
              <tr>
                {ROLES.map((role) => (
                  <th key={role} scope="col" className="border-b border-hairline py-2 pe-4">
                    {t(`ankiImport.roles.${role}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((note, index) => (
                <tr key={index}>
                  <td lang="zh-Hans" className="py-2 pe-4">
                    {note.characters}
                  </td>
                  <td className="py-2 pe-4">{note.pinyin}</td>
                  <td className="py-2 pe-4">{note.meaning}</td>
                  <td className="py-2 pe-4">{note.sound}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

type Checked = Promise<{
  readonly plan: Result<ImportPlan, ReviewLogFailure>;
  readonly free: number | null;
}>;

/**
 * What the history brings and how it is dated and counted, told before importing: answers keep
 * their time but not their time zone, and count toward the goal, XP, streak and achievements.
 */
const HistorySummary = ({
  answers,
  goal,
}: {
  readonly answers: readonly PlannedReview[];
  readonly goal: number;
}) => {
  const { t, i18n } = useTranslation();
  const [first] = answers;
  if (first == null) return <p>{t("ankiImport.noAnswers")}</p>;
  // Not Math.min(...times): a long history exceeds the argument limit.
  const [from, to] = answers.reduce(
    ([min, max], { at }) => [Math.min(min, at), Math.max(max, at)],
    [first.at, first.at],
  );
  const dates = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).formatRange(
    from,
    to,
  );
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <>
      <p>{t("ankiImport.history", { count: answers.length, dates })}</p>
      <p>{t("ankiImport.timeZone", { zone })}</p>
      <p>{t("ankiImport.historyCounts", { goal })}</p>
    </>
  );
};

/**
 * The plan's counts and lists; `action` gets the chosen words and notes when they can be imported,
 * with the answers they take from the history when it is imported.
 */
const Summary = ({
  checked,
  ankiPackage,
  withNotes,
  onWithNotes,
  cardMappings,
  goal,
  action,
}: {
  readonly checked: Checked;
  readonly ankiPackage: AnkiPackage;
  readonly withNotes: boolean;
  readonly onWithNotes: (withNotes: boolean) => void;
  /** `null` when the review history is not imported. */
  readonly cardMappings: ReadonlyMap<string, CardMapping> | null;
  readonly goal: number;
  readonly action: (plan: ImportPlan | null, answers: readonly PlannedReview[]) => ReactNode;
}) => {
  const { t, i18n } = useTranslation();
  const { plan, free } = use(checked);
  const answers = useMemo(() => {
    if (!plan.ok || cardMappings === null) return [];
    const { words, notes } = plan.value;
    return planHistory(ankiPackage, withNotes ? [...words, ...notes] : words, cardMappings);
  }, [ankiPackage, plan, withNotes, cardMappings]);
  if (!plan.ok)
    return (
      <>
        <p role="alert" className="mt-4 text-danger">
          {t("ankiImport.planFailed", { reason: describeFailure(plan.error) })}
        </p>
        {action(null, [])}
      </>
    );
  const { unmatched, ignored, missingAudio, notAudio } = plan.value;
  const chosen = withNotes ? plan.value : { ...plan.value, notes: [] };
  const empty = chosen.words.length + chosen.notes.length === 0;
  const short = isQuotaShort(chosen, free);
  const size = formatSize(audioBytes(chosen), i18n.language);
  const voiced = [...chosen.words, ...chosen.notes].filter((item) => item.audio !== null).length;
  return (
    <div className="mt-4 flex flex-col gap-2">
      <p>{t("ankiImport.words", { count: chosen.words.length })}</p>
      {unmatched.length > 0 && (
        <details>
          <summary className="cursor-pointer">
            {t("ankiImport.unmatched", { count: unmatched.length })}
          </summary>
          <ul className="mt-2 list-disc ps-6">
            {unmatched.map((note, index) => (
              <li key={index}>
                <span lang="zh-Hans">{note.characters}</span>
                {note.pinyin !== "" && ` ${note.pinyin}`}
                {note.meaning !== "" && ` · ${note.meaning}`}
                {` — ${t(`ankiImport.reasons.${note.reason}`)}`}
                {note.meaning === "" && ` · ${t("ankiImport.noMeaning")}`}
              </li>
            ))}
          </ul>
        </details>
      )}
      {plan.value.notes.length > 0 && (
        <label className="flex min-h-11 cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={withNotes}
            onChange={(event) => {
              onWithNotes(event.target.checked);
            }}
            className="size-5 accent-ink"
          />
          {t("ankiImport.withNotes", { count: plan.value.notes.length })}
        </label>
      )}
      {voiced > 0 && <p>{t("ankiImport.audio", { count: voiced, size })}</p>}
      {cardMappings !== null && <HistorySummary answers={answers} goal={goal} />}
      {ignored > 0 && <p>{t("ankiImport.ignored", { count: ignored })}</p>}
      {missingAudio.length > 0 && (
        <p>
          {t("ankiImport.missingAudio", { count: missingAudio.length, names: names(missingAudio) })}
        </p>
      )}
      {notAudio.length > 0 && (
        <p>{t("ankiImport.notAudio", { count: notAudio.length, names: names(notAudio) })}</p>
      )}
      {empty && <p role="alert">{t("ankiImport.nothingToImport")}</p>}
      {voiced > 0 && free === null && <p className="text-muted">{t("ankiImport.freeUnknown")}</p>}
      {short && free !== null && (
        <p role="alert" className="text-danger">
          {t("ankiImport.tooBig", { size, free: formatSize(free, i18n.language) })}
        </p>
      )}
      {action(short || empty ? null : chosen, answers)}
    </div>
  );
};

const initialMappings = (ankiPackage: AnkiPackage): Map<string, FieldMapping> =>
  new Map(
    ankiPackage.noteTypes.map((noteType) => {
      const stored = loadMapping(storage, noteType);
      return [
        noteType.id,
        (stored.ok ? stored.value : null) ?? guessMapping(noteType, ankiPackage),
      ];
    }),
  );

const initialCards = (
  ankiPackage: AnkiPackage,
  mappings: ReadonlyMap<string, FieldMapping>,
): Map<string, CardMapping> =>
  new Map(
    ankiPackage.noteTypes.flatMap((noteType) => {
      const mapping = mappings.get(noteType.id);
      if (mapping == null) return [];
      const stored = loadCards(storage, noteType);
      return [[noteType.id, (stored.ok ? stored.value : null) ?? guessCards(noteType, mapping)]];
    }),
  );

type Outcome =
  | {
      readonly kind: "imported";
      readonly name: string;
      readonly words: number;
      readonly notes: number;
      readonly audio: number;
      /** Reviews added, `null` when no answer was to be imported. */
      readonly reviews: number | null;
      readonly unsaved: string | null;
    }
  | { readonly kind: "failed"; readonly message: string };

const ImportForm = ({ loaded }: { readonly loaded: Loaded }) => {
  const { t } = useTranslation();
  const { ankiPackage, fileName } = loaded;
  const summaryId = useId();
  const [mappings, setMappings] = useState(() => initialMappings(ankiPackage));
  const [cardMappings, setCardMappings] = useState(() => initialCards(ankiPackage, mappings));
  const [withHistory, setWithHistory] = useState(false);
  const [goal] = useState(() => currentSetting(storage, DAILY_GOAL));
  const check = (next: ReadonlyMap<string, FieldMapping>): Checked =>
    Promise.all([planImport(database, ankiPackage, next), freeSpace(browserStorage())]).then(
      ([plan, free]) => ({ plan, free }),
    );
  const [checked, setChecked] = useState(() => check(mappings));
  const [withNotes, setWithNotes] = useState(true);
  const [, startTransition] = useTransition();
  const [name, setName] = useState(
    (ankiPackage.deckName ?? fileName.replace(/\.apkg$/iu, "")).slice(0, DECK_NAME_MAX),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const remap = (noteType: AnkiNoteType, mapping: FieldMapping): void => {
    const next = new Map(mappings).set(noteType.id, mapping);
    setMappings(next);
    startTransition(() => {
      setChecked(check(next));
    });
  };

  const submit = async (plan: ImportPlan, answers: readonly PlannedReview[]): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    const reviews = await historyReviews(answers, goal, deviceOffset);
    const result = await importPlan(database, ankiPackage, plan, name, reviews);
    setBusy(false);
    if (!result.ok) {
      if (result.error.kind === "deck-name") setProblem(importFailure(t, result.error));
      else setOutcome({ kind: "failed", message: importFailure(t, result.error) });
      return;
    }
    setProblem(null);
    const saved = saveMappings(storage, ankiPackage.noteTypes, mappings, cardMappings);
    setOutcome({
      kind: "imported",
      ...result.value,
      reviews: answers.length === 0 ? null : result.value.reviews,
      unsaved: saved.ok ? null : saved.error,
    });
  };

  if (outcome?.kind === "imported")
    return (
      <div className="mt-6 flex flex-col items-start gap-4">
        <p role="status">
          {t("ankiImport.imported", outcome)}
          {outcome.reviews !== null &&
            ` ${
              outcome.reviews === 0
                ? t("ankiImport.noNewReviews")
                : t("ankiImport.importedReviews", { count: outcome.reviews })
            }`}
        </p>
        {outcome.unsaved !== null && (
          <p role="alert" className="text-danger">
            {t("ankiImport.mappingNotSaved", { reason: outcome.unsaved })}
          </p>
        )}
        <Link to="/learn" className={buttonVariants({ variant: "outline" })}>
          {t("ankiImport.backToLearn")}
        </Link>
      </div>
    );

  return (
    <>
      <p className="mt-6 text-muted">{t("ankiImport.file", { name: fileName })}</p>
      {ankiPackage.reviews.length > 0 ? (
        <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={withHistory}
            onChange={(event) => {
              setWithHistory(event.target.checked);
            }}
            className="size-5 accent-ink"
          />
          {t("ankiImport.withHistory")}
        </label>
      ) : (
        <p className="mt-2 text-muted">{t("ankiImport.noHistoryInFile")}</p>
      )}
      {ankiPackage.noteTypes.map((noteType) => {
        const mapping = mappings.get(noteType.id) ?? guessMapping(noteType, ankiPackage);
        return (
          <NoteTypeMapping
            key={noteType.id}
            noteType={noteType}
            ankiPackage={ankiPackage}
            mapping={mapping}
            onChange={(next) => {
              remap(noteType, next);
            }}
            cards={
              withHistory ? (cardMappings.get(noteType.id) ?? guessCards(noteType, mapping)) : null
            }
            onCards={(cards) => {
              setCardMappings(new Map(cardMappings).set(noteType.id, cards));
            }}
          />
        );
      })}
      <section aria-labelledby={summaryId} className="mt-8">
        <h2 id={summaryId} className="text-subtitle">
          {t("ankiImport.summary")}
        </h2>
        <Suspense fallback={<p className="mt-4 text-muted">{t("ankiImport.checking")}</p>}>
          <Summary
            checked={checked}
            ankiPackage={ankiPackage}
            withNotes={withNotes}
            onWithNotes={setWithNotes}
            cardMappings={withHistory ? cardMappings : null}
            goal={goal}
            action={(plan, answers) => (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (plan !== null) void submit(plan, answers);
                }}
                className="mt-6"
              >
                <NameField
                  label={t("ankiImport.deckName")}
                  value={name}
                  onChange={setName}
                  problem={problem}
                />
                <Button type="submit" className="mt-4" disabled={busy || plan === null}>
                  {t(busy ? "ankiImport.importing" : "ankiImport.import")}
                </Button>
              </form>
            )}
          />
        </Suspense>
      </section>
      {outcome?.kind === "failed" && (
        <p role="alert" className="mt-4 text-danger">
          {outcome.message}
        </p>
      )}
    </>
  );
};

/** Imports an `.apkg` read on the device: notes matching dictionary readings become a deck. */
export const AnkiImportPage = () => {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);

  const open = async (file: File): Promise<void> => {
    setReading(true);
    setFailure(null);
    setLoaded(null);
    const result = await readPackage(file);
    setReading(false);
    if (!result.ok) {
      setFailure(packageFailure(t, result.error));
      return;
    }
    setLoaded({ ankiPackage: result.value, fileName: file.name });
    setLoads((count) => count + 1);
  };

  return (
    <section aria-labelledby="anki-import-title" className="max-w-3xl">
      <h1 id="anki-import-title" className="text-title">
        {t("ankiImport.title")}
      </h1>
      <p className="mt-2 text-muted">{t("ankiImport.intro")}</p>
      <Button
        variant="outline"
        className="mt-6"
        disabled={reading}
        onClick={() => input.current?.click()}
      >
        <Upload aria-hidden="true" className="size-4" />
        {t("ankiImport.choose")}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".apkg"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.item(0) ?? null;
          event.currentTarget.value = "";
          if (file !== null) void open(file);
        }}
      />
      <p role="status" className="mt-3 text-small">
        {reading && t("ankiImport.reading")}
      </p>
      {failure !== null && (
        <p role="alert" className="mt-2 text-danger">
          {failure}
        </p>
      )}
      {loaded !== null && <ImportForm key={loads} loaded={loaded} />}
    </section>
  );
};
