/** English and French words too common to narrow a search; they are not indexed. */
const STOP_WORDS = new Set(
  "a an and as at by for from in of on or s the to with au aux d de des du en et l la le les ou un une".split(
    " ",
  ),
);

const WORD = /[\p{Script=Latin}\d]+/gu;

/** Lowercase, without accents or ligatures: `Œuvre d’Été` → `oeuvre d'ete`. */
export const fold = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/œ/gu, "oe")
    .replace(/æ/gu, "ae")
    .replace(/’/gu, "'");

/** Latin words of a text, folded; bracketed pinyin (`电话[dian4 hua4]`) is left out. */
export const latinWords = (text: string): string[] =>
  fold(text.replace(/\[[^\]]*\]/gu, " ")).match(WORD) ?? [];

/** The words a gloss is found by. */
export const indexedWords = (text: string): string[] =>
  latinWords(text).filter((word) => !STOP_WORDS.has(word));

/** A gloss compared as a whole: folded, without parentheses or a leading `to` (`to call (sb)` → `call`). */
export const glossPhrase = (text: string): string =>
  latinWords(text.replace(/\([^)]*\)/gu, " "))
    .join(" ")
    .replace(/^to /u, "");
