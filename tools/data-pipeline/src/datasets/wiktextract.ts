import { z } from "zod";

/** Shared by the kaikki.org extracts of the French and English Wiktionary. */
export const Tags = z.array(z.string()).default([]);

export const Sound = z.object({ zh_pron: z.string().default(""), tags: Tags });
export const Form = z.object({ form: z.string(), tags: Tags });

export const HAN = /^\p{Script=Han}+$/u;

/** `ǎn (an³)` and `dì (di⁴), de (de⁵)` hold a numbered annotation or several readings. */
export const readingsOf = (pinyin: string): readonly string[] =>
  pinyin
    .replace(/\([^)]*\)/gu, "")
    .split(/[,;]/u)
    .map((reading) => reading.trim())
    .filter((reading) => reading !== "");

/** Distinct written forms with that tag, other than the title, in Chinese characters only. */
export const formsTagged = (
  word: string,
  forms: readonly z.output<typeof Form>[],
  tag: string,
): readonly string[] => [
  ...new Set(
    forms
      .filter((form) => form.tags.includes(tag) && form.form !== word && HAN.test(form.form))
      .map((form) => form.form),
  ),
];

export const tsv = (header: string, lines: readonly string[]): string =>
  `${[header, ...lines].join("\n")}\n`;

export const countBy = (items: readonly { readonly kind: string }[]): string => {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  return [...counts].map(([kind, count]) => `${String(count)} ${kind}`).join(", ");
};
