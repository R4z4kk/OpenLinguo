import type { Gloss, GlossLanguage } from "@openlinguo/core";
import { fold } from "./search-keys.ts";

export type GlossSummary = { readonly lang: GlossLanguage; readonly texts: readonly string[] };

/**
 * The glosses of the first language that has some, in order: classifiers (`CL:部[bu4]`) are
 * left out, and a gloss repeated by another source with another case or a final period is
 * shown once.
 */
export const summarizeGlosses = (
  glosses: readonly Gloss[],
  languages: readonly GlossLanguage[],
): GlossSummary | null => {
  for (const lang of languages) {
    const texts = new Map<string, string>();
    for (const { lang: glossLang, text } of glosses) {
      const key = fold(text).replace(/[\s.]+$/u, "");
      if (glossLang === lang && !text.startsWith("CL:") && !texts.has(key)) texts.set(key, text);
    }
    if (texts.size > 0) return { lang, texts: [...texts.values()] };
  }
  return null;
};

export type GlossGroup = {
  readonly source: string;
  readonly lang: GlossLanguage;
  readonly texts: readonly string[];
};

/** Glosses by source, the sources of `language` first, classifiers left out. */
export const groupGlosses = (
  glosses: readonly Gloss[],
  language: GlossLanguage,
): readonly GlossGroup[] => {
  const groups = new Map<string, { source: string; lang: GlossLanguage; texts: string[] }>();
  for (const { lang, text, source } of glosses) {
    if (text.startsWith("CL:")) continue;
    const group = groups.get(source) ?? { source, lang, texts: [] };
    group.texts.push(text);
    groups.set(source, group);
  }
  return [...groups.values()].sort(
    (a, b) => Number(b.lang === language) - Number(a.lang === language),
  );
};
