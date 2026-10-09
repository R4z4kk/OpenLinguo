import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "@/components/segmented-control";
import {
  DEFAULT_LANGUAGE,
  languageNames,
  languages,
  loadLanguage,
  saveLanguage,
  type Language,
} from "@/i18n/language";

const storage = (): Storage => localStorage;

export const LanguageSwitcher = () => {
  const { t, i18n } = useTranslation();
  const [initial] = useState(() => loadLanguage(storage, navigator.languages));
  const [failure, setFailure] = useState<string | null>(initial.ok ? null : initial.error);
  const current = languages.find((language) => language === i18n.language) ?? DEFAULT_LANGUAGE;

  return (
    <SegmentedControl<Language>
      legend={t("language.legend")}
      name="language"
      options={languages.map((value) => ({ value, label: languageNames[value], lang: value }))}
      value={current}
      onChange={(next) => {
        void i18n.changeLanguage(next);
        const saved = saveLanguage(storage, next);
        setFailure(saved.ok ? null : saved.error);
      }}
      failure={failure === null ? null : t("language.notSaved", { reason: failure })}
    />
  );
};
