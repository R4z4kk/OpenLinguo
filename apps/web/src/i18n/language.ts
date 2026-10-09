import { ok, type Result } from "@openlinguo/core";
import { readStored, writeStored } from "@/lib/stored";

export const languages = ["fr", "en"] as const;
export type Language = (typeof languages)[number];

/** For a browser in neither French nor English. */
export const DEFAULT_LANGUAGE: Language = "en";

/** Each language named in itself, shown with its own `lang`. */
export const languageNames: Readonly<Record<Language, string>> = { fr: "Français", en: "English" };

const STORAGE_KEY = "openlinguo.language";

const asLanguage = (value: string | null): Language | null =>
  languages.find((language) => language === value) ?? null;

/** First supported language among the browser's preferred tags (`fr-CA` → `fr`). */
export const browserLanguage = (tags: readonly string[]): Language => {
  for (const tag of tags) {
    const language = asLanguage(tag.toLowerCase().split("-")[0] ?? null);
    if (language !== null) return language;
  }
  return DEFAULT_LANGUAGE;
};

/** The stored choice, else the browser's language; fails when storage is unavailable. */
export const loadLanguage = (
  storage: () => Pick<Storage, "getItem">,
  browserTags: readonly string[],
): Result<Language, string> => {
  const stored = readStored(storage, STORAGE_KEY);
  return stored.ok ? ok(asLanguage(stored.value) ?? browserLanguage(browserTags)) : stored;
};

export const saveLanguage = (
  storage: () => Pick<Storage, "setItem">,
  language: Language,
): Result<null, string> => writeStored(storage, STORAGE_KEY, language);
