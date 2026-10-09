import { createInstance, type i18n } from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./en.ts";
import { fr } from "./fr.ts";
import type { Language } from "./language.ts";

export const createI18n = (language: Language): i18n => {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    lng: language,
    fallbackLng: "en",
    resources: { en: { translation: en }, fr: { translation: fr } },
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
};

/** Keeps `lang` on the given element equal to the active language. */
export const bindDocumentLanguage = (instance: i18n, element: { lang: string }): void => {
  element.lang = instance.language;
  instance.on("languageChanged", (language) => {
    element.lang = language;
  });
};
