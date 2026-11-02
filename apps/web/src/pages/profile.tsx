import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { currentSetting } from "@/data/daily-goal";
import { useData } from "@/data/data-context";
import { SHOW_PROGRESS } from "@/data/progress";
import { AiSettingsSection } from "@/shell/ai-settings";
import { BackupControls } from "@/shell/backup-controls";
import { RecordingsControls } from "@/shell/recordings-controls";
import { GoalSwitcher } from "@/shell/goal-switcher";
import { InterestsSection } from "@/shell/interests";
import { LanguageSwitcher } from "@/shell/language-switcher";
import { LearningStats } from "@/shell/learning-stats";
import { PracticeSwitches } from "@/shell/practice-switches";
import { ProgressSummary } from "@/shell/progress-summary";
import { ProgressSwitch } from "@/shell/progress-switch";
import { ReferentialSwitcher } from "@/shell/referential-switcher";
import { ThemeSwitcher } from "@/shell/theme-switcher";

const storage = (): Storage => localStorage;

export const ProfilePage = () => {
  const { t } = useTranslation();
  const { state, persistence } = useData();
  // Switchers, progress and stats read their data again after a backup restores them.
  const [restored, setRestored] = useState(0);
  const [showProgress, setShowProgress] = useState(() => currentSetting(storage, SHOW_PROGRESS));
  // Sections that call the AI read the connection again after each settings save.
  const [aiVersion, setAiVersion] = useState(0);
  return (
    <section>
      <h1 className="text-title">{t("profile.title")}</h1>
      {showProgress && (
        <>
          <h2 className="mt-8 text-subtitle">{t("progress.title")}</h2>
          <ProgressSummary key={`progress-${String(restored)}`} />
        </>
      )}
      <h2 className="mt-8 text-subtitle">{t("stats.title")}</h2>
      <LearningStats key={`stats-${String(restored)}`} />
      <h2 className="mt-8 text-subtitle">{t("profile.learning")}</h2>
      <div key={`learning-${String(restored)}`} className="mt-4 flex flex-col gap-6">
        <ReferentialSwitcher />
        <GoalSwitcher name="dailyGoal" />
        <GoalSwitcher name="newCardsPerDay" />
        <GoalSwitcher name="coverageTarget" />
        <PracticeSwitches />
      </div>
      <h2 className="mt-8 text-subtitle">{t("profile.display")}</h2>
      <div key={`display-${String(restored)}`} className="mt-4 flex flex-col gap-6">
        <ProgressSwitch shown={showProgress} onChange={setShowProgress} />
        <LanguageSwitcher />
        <ThemeSwitcher />
      </div>
      {state.status === "ready" && state.pack.prompts !== null && (
        <>
          <AiSettingsSection
            correction={state.pack.prompts.correction}
            onSaved={() => {
              setAiVersion((version) => version + 1);
            }}
          />
          <InterestsSection
            key={`interests-${String(restored)}`}
            vocabulary={state.pack.prompts.vocabulary}
            features={state.pack.features}
            aiVersion={aiVersion}
          />
        </>
      )}
      <h2 className="mt-8 text-subtitle">{t("profile.data")}</h2>
      {persistence !== null && <p className="mt-4 text-muted">{t(`persistence.${persistence}`)}</p>}
      <BackupControls
        onRestored={() => {
          setRestored((count) => count + 1);
          setShowProgress(currentSetting(storage, SHOW_PROGRESS));
        }}
      />
      <RecordingsControls />
      <p className="mt-8">
        <Link to="/profile/account" className="inline-flex min-h-11 items-center underline">
          {t("account.link")}
        </Link>
      </p>
      <p>
        <Link to="/profile/about" className="inline-flex min-h-11 items-center underline">
          {t("about.title")}
        </Link>
      </p>
    </section>
  );
};
