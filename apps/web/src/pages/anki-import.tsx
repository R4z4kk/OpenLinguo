import type { Result } from "@openlinguo/core";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { Upload } from "lucide-react";
import { Suspense, use, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NameField } from "@/components/name-field";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  freeSpace,
  guessMapping,
  importPlan,
  isQuotaShort,
  loadMapping,
  noteText,
  planImport,
  ROLES,
  saveMappings,
  type AnkiImportFailure,
  type FieldMapping,
  type ImportPlan,
  type Role,
} from "@/data/anki-import";
import {
  readPackage,
  type AnkiFailure,
  type AnkiNoteType,
  type AnkiPackage,
} from "@/data/anki-package";
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

const NoteTypeMapping = ({
  noteType,
  ankiPackage,
  mapping,
  onChange,
}: {
  readonly noteType: AnkiNoteType;
  readonly ankiPackage: AnkiPackage;
  readonly mapping: FieldMapping;
  readonly onChange: (mapping: FieldMapping) => void;
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

/** The plan's counts and lists; `action` gets the plan when it can be imported. */
const Summary = ({
  checked,
  action,
}: {
  readonly checked: Checked;
  readonly action: (plan: ImportPlan | null) => ReactNode;
}) => {
  const { t, i18n } = useTranslation();
  const { plan, free } = use(checked);
  if (!plan.ok)
    return (
      <>
        <p role="alert" className="mt-4 text-danger">
          {t("ankiImport.planFailed", { reason: describeFailure(plan.error) })}
        </p>
        {action(null)}
      </>
    );
  const { words, unmatched, ignored, missingAudio, notAudio, audioBytes } = plan.value;
  const short = isQuotaShort(plan.value, free);
  const voiced = words.filter((word) => word.audio !== null).length;
  return (
    <div className="mt-4 flex flex-col gap-2">
      <p>{t("ankiImport.words", { count: words.length })}</p>
      {voiced > 0 && (
        <p>
          {t("ankiImport.audio", { count: voiced, size: formatSize(audioBytes, i18n.language) })}
        </p>
      )}
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
              </li>
            ))}
          </ul>
        </details>
      )}
      {ignored > 0 && <p>{t("ankiImport.ignored", { count: ignored })}</p>}
      {missingAudio.length > 0 && (
        <p>
          {t("ankiImport.missingAudio", { count: missingAudio.length, names: names(missingAudio) })}
        </p>
      )}
      {notAudio.length > 0 && (
        <p>{t("ankiImport.notAudio", { count: notAudio.length, names: names(notAudio) })}</p>
      )}
      {words.length === 0 && <p role="alert">{t("ankiImport.nothingToImport")}</p>}
      {voiced > 0 && free === null && <p className="text-muted">{t("ankiImport.freeUnknown")}</p>}
      {short && free !== null && (
        <p role="alert" className="text-danger">
          {t("ankiImport.tooBig", {
            size: formatSize(audioBytes, i18n.language),
            free: formatSize(free, i18n.language),
          })}
        </p>
      )}
      {action(short || words.length === 0 ? null : plan.value)}
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

type Outcome =
  | {
      readonly kind: "imported";
      readonly name: string;
      readonly words: number;
      readonly audio: number;
      readonly unsaved: string | null;
    }
  | { readonly kind: "failed"; readonly message: string };

const ImportForm = ({ loaded }: { readonly loaded: Loaded }) => {
  const { t } = useTranslation();
  const { ankiPackage, fileName } = loaded;
  const summaryId = useId();
  const [mappings, setMappings] = useState(() => initialMappings(ankiPackage));
  const check = (next: ReadonlyMap<string, FieldMapping>): Checked =>
    Promise.all([planImport(database, ankiPackage, next), freeSpace(browserStorage())]).then(
      ([plan, free]) => ({ plan, free }),
    );
  const [checked, setChecked] = useState(() => check(mappings));
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

  const submit = async (plan: ImportPlan): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    const result = await importPlan(database, ankiPackage, plan, name);
    setBusy(false);
    if (!result.ok) {
      if (result.error.kind === "deck-name") setProblem(importFailure(t, result.error));
      else setOutcome({ kind: "failed", message: importFailure(t, result.error) });
      return;
    }
    setProblem(null);
    const saved = saveMappings(storage, ankiPackage.noteTypes, mappings);
    setOutcome({ kind: "imported", ...result.value, unsaved: saved.ok ? null : saved.error });
  };

  if (outcome?.kind === "imported")
    return (
      <div className="mt-6 flex flex-col items-start gap-4">
        <p role="status">{t("ankiImport.imported", outcome)}</p>
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
      {ankiPackage.noteTypes.map((noteType) => (
        <NoteTypeMapping
          key={noteType.id}
          noteType={noteType}
          ankiPackage={ankiPackage}
          mapping={mappings.get(noteType.id) ?? guessMapping(noteType, ankiPackage)}
          onChange={(mapping) => {
            remap(noteType, mapping);
          }}
        />
      ))}
      <section aria-labelledby={summaryId} className="mt-8">
        <h2 id={summaryId} className="text-subtitle">
          {t("ankiImport.summary")}
        </h2>
        <Suspense fallback={<p className="mt-4 text-muted">{t("ankiImport.checking")}</p>}>
          <Summary
            checked={checked}
            action={(plan) => (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (plan !== null) void submit(plan);
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
