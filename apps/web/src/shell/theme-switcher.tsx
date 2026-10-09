import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "@/components/segmented-control";
import {
  applyPreference,
  loadPreference,
  savePreference,
  themePreferences,
  type ThemePreference,
} from "@/theme";

const storage = (): Storage => localStorage;

export const ThemeSwitcher = () => {
  const { t } = useTranslation();
  const [initial] = useState(() => loadPreference(storage));
  const [preference, setPreference] = useState<ThemePreference>(
    initial.ok ? initial.value : "system",
  );
  const [failure, setFailure] = useState<string | null>(initial.ok ? null : initial.error);

  return (
    <SegmentedControl
      legend={t("theme.legend")}
      name="theme"
      options={themePreferences.map((value) => ({ value, label: t(`theme.${value}`), lang: null }))}
      value={preference}
      onChange={(next) => {
        setPreference(next);
        applyPreference(document.documentElement, next);
        const saved = savePreference(storage, next);
        setFailure(saved.ok ? null : saved.error);
      }}
      failure={failure === null ? null : t("theme.notSaved", { reason: failure })}
    />
  );
};
