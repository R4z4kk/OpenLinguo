import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useData } from "@/data/data-context";
import { BackupControls } from "@/shell/backup-controls";
import { GoalSwitcher } from "@/shell/goal-switcher";
import { LanguageSwitcher } from "@/shell/language-switcher";
import { ReferentialSwitcher } from "@/shell/referential-switcher";
import { ThemeSwitcher } from "@/shell/theme-switcher";

export const ProfilePage = () => {
  const { t } = useTranslation();
  const { persistence } = useData();
  // Switchers read the stored settings again after a backup restores them.
  const [restored, setRestored] = useState(0);
  return (
    <section>
      <h1 className="text-title">{t("profile.title")}</h1>
      <h2 className="mt-8 text-subtitle">{t("profile.learning")}</h2>
      <div key={`learning-${String(restored)}`} className="mt-4 flex flex-col gap-6">
        <ReferentialSwitcher />
        <GoalSwitcher name="dailyGoal" />
        <GoalSwitcher name="newCardsPerDay" />
      </div>
      <h2 className="mt-8 text-subtitle">{t("profile.display")}</h2>
      <div key={`display-${String(restored)}`} className="mt-4 flex flex-col gap-6">
        <LanguageSwitcher />
        <ThemeSwitcher />
      </div>
      <h2 className="mt-8 text-subtitle">{t("profile.data")}</h2>
      {persistence !== null && <p className="mt-4 text-muted">{t(`persistence.${persistence}`)}</p>}
      <BackupControls
        onRestored={() => {
          setRestored((count) => count + 1);
        }}
      />
      <p className="mt-8">
        <Link to="/profile/about" className="inline-flex min-h-11 items-center underline">
          {t("about.title")}
        </Link>
      </p>
    </section>
  );
};
