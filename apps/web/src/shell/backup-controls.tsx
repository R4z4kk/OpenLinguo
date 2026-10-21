import { ok } from "@openlinguo/core";
import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  exportBackup,
  importBackup,
  parseBackup,
  type BackupFailure,
  type ImportSummary,
  type Settings,
} from "@/data/backup";
import { currentSetting, DAILY_GOAL, NEW_CARDS_PER_DAY, saveSetting } from "@/data/daily-goal";
import { useData } from "@/data/data-context";
import { database } from "@/data/database";
import { describeDeckFailure } from "@/data/decks";
import { loadInterests, saveInterests } from "@/data/interests";
import { PRACTICE_TYPING, PRACTICE_WRITING, WRITE_ON_PAPER } from "@/data/practice";
import { SHOW_PROGRESS } from "@/data/progress";
import { describeFailure } from "@/data/review-log";
import { DEFAULT_LANGUAGE, languages, saveLanguage } from "@/i18n/language";
import { applyPreference, parsePreference, savePreference } from "@/theme";

const storage = (): Storage => localStorage;
const SHOWN_ISSUES = 5;

type Outcome =
  | { readonly kind: "exported" }
  | { readonly kind: "imported"; readonly summary: ImportSummary; readonly unsaved: string | null }
  | {
      readonly kind: "failed";
      readonly step: "export" | "read" | "import";
      readonly reason: string;
    }
  | { readonly kind: "invalid"; readonly failure: BackupFailure };

const localDate = (now: Date): string =>
  new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

const download = (text: string, name: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Some browsers read the URL after `click` returns.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60_000);
};

type Failed = Extract<Outcome, { readonly kind: "failed" | "invalid" }>;

const Failure = ({ outcome }: { readonly outcome: Failed }) => {
  const { t } = useTranslation();
  if (outcome.kind === "failed")
    return <p>{t(`backup.${outcome.step}Failed`, { reason: outcome.reason })}</p>;
  const { failure } = outcome;
  switch (failure.kind) {
    case "not-json":
      return <p>{t("backup.notJson", { reason: failure.message })}</p>;
    case "not-backup":
      return <p>{t("backup.notBackup")}</p>;
    case "newer-version":
      return <p>{t("backup.newerVersion", { version: failure.version })}</p>;
    case "invalid": {
      const hidden = failure.issues.length - SHOWN_ISSUES;
      return (
        <>
          <p>{t("backup.invalid")}</p>
          <ul className="mt-2 list-disc ps-6">
            {failure.issues.slice(0, SHOWN_ISSUES).map(({ path, message }) => (
              <li key={`${path}	${message}`}>
                {path !== "" && <code>{path}</code>} {message}
              </li>
            ))}
          </ul>
          {hidden > 0 && <p className="mt-2">{t("backup.moreIssues", { count: hidden })}</p>}
        </>
      );
    }
  }
};

/** Exports and imports the learning data; an import applies the backup's settings. */
export const BackupControls = ({ onRestored }: { readonly onRestored: () => void }) => {
  const { t, i18n } = useTranslation();
  const { referential, chooseReferential } = useData();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const settings = (): Settings => {
    // Unreadable interests are reported in their own section and left out.
    const kept = loadInterests(storage);
    return {
      language: languages.find((language) => language === i18n.language) ?? DEFAULT_LANGUAGE,
      theme: parsePreference(document.documentElement.getAttribute("data-theme")),
      referential,
      dailyGoal: currentSetting(storage, DAILY_GOAL),
      newCardsPerDay: currentSetting(storage, NEW_CARDS_PER_DAY),
      showProgress: currentSetting(storage, SHOW_PROGRESS),
      practiceTyping: currentSetting(storage, PRACTICE_TYPING),
      practiceWriting: currentSetting(storage, PRACTICE_WRITING),
      writeOnPaper: currentSetting(storage, WRITE_ON_PAPER),
      interests: kept.ok ? kept.value : null,
    };
  };

  const exportFile = async (): Promise<void> => {
    const now = new Date();
    const backup = await exportBackup(database, settings(), now);
    if (!backup.ok) {
      setOutcome({ kind: "failed", step: "export", reason: describeFailure(backup.error) });
      return;
    }
    download(JSON.stringify(backup.value, null, 2), `openlinguo-backup-${localDate(now)}.json`);
    setOutcome({ kind: "exported" });
  };

  const apply = ({
    language,
    theme,
    referential: chosen,
    dailyGoal,
    newCardsPerDay,
    showProgress,
    practiceTyping,
    practiceWriting,
    writeOnPaper,
    interests,
  }: Settings): string | null => {
    void i18n.changeLanguage(language);
    applyPreference(document.documentElement, theme);
    chooseReferential(chosen);
    const saved = [
      saveLanguage(storage, language),
      savePreference(storage, theme),
      saveSetting(storage, DAILY_GOAL, dailyGoal),
      saveSetting(storage, NEW_CARDS_PER_DAY, newCardsPerDay),
      saveSetting(storage, SHOW_PROGRESS, showProgress),
      saveSetting(storage, PRACTICE_TYPING, practiceTyping),
      saveSetting(storage, PRACTICE_WRITING, practiceWriting),
      saveSetting(storage, WRITE_ON_PAPER, writeOnPaper),
      interests === null ? ok(null) : saveInterests(storage, interests),
    ];
    return saved.flatMap((result) => (result.ok ? [] : [result.error]))[0] ?? null;
  };

  const importFile = async (file: File): Promise<Outcome> => {
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      return { kind: "failed", step: "read", reason: String(error) };
    }
    const backup = parseBackup(text);
    if (!backup.ok) return { kind: "invalid", failure: backup.error };
    const imported = await importBackup(database, backup.value);
    if (!imported.ok)
      return { kind: "failed", step: "import", reason: describeDeckFailure(imported.error) };
    const unsaved = apply(backup.value.settings);
    onRestored();
    return { kind: "imported", summary: imported.value, unsaved };
  };

  return (
    <div className="mt-4">
      <p className="text-muted">{t("backup.intro")}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={() => {
            setOutcome(null);
            void exportFile();
          }}
        >
          <Download aria-hidden="true" className="size-4" />
          {t("backup.export")}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          <Upload aria-hidden="true" className="size-4" />
          {t("backup.import")}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.item(0) ?? null;
            // The same file can be chosen again.
            event.currentTarget.value = "";
            if (file === null) return;
            setBusy(true);
            setOutcome(null);
            void importFile(file).then((next) => {
              setOutcome(next);
              setBusy(false);
            });
          }}
        />
      </div>
      <p role="status" className="mt-3 text-small">
        {outcome?.kind === "exported" && t("backup.exported")}
        {outcome?.kind === "imported" && t("backup.imported", outcome.summary)}
        {outcome?.kind === "imported" &&
          outcome.summary.challenges > 0 &&
          ` ${t("challenge.imported", { count: outcome.summary.challenges })}`}
        {outcome?.kind === "imported" &&
          outcome.summary.journal > 0 &&
          ` ${t("journal.imported", { count: outcome.summary.journal })}`}
        {outcome?.kind === "imported" &&
          outcome.summary.texts > 0 &&
          ` ${t("library.imported", { count: outcome.summary.texts })}`}
        {outcome?.kind === "imported" &&
          outcome.summary.marks > 0 &&
          ` ${t("library.importedMarks", { count: outcome.summary.marks })}`}
      </p>
      {outcome?.kind === "imported" && outcome.unsaved !== null && (
        <p role="alert" className="mt-2 text-danger">
          {t("backup.settingsNotSaved", { reason: outcome.unsaved })}
        </p>
      )}
      {(outcome?.kind === "failed" || outcome?.kind === "invalid") && (
        <div role="alert" className="mt-2 text-danger">
          <Failure outcome={outcome} />
        </div>
      )}
    </div>
  );
};
