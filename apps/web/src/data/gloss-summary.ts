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
