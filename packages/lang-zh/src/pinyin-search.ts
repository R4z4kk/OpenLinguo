import { parseNumbered, type Tone } from "./pinyin.ts";

/** A tone the learner typed, at a letter of the query key. */
export type ToneAt = {
  readonly at: number;
  readonly tone: Tone;
  /** A tone number closes its syllable; a tone mark only sits inside it. */
  readonly boundary: boolean;
};

/** Pinyin typed with or without tones: `diànhuà`, `dian4hua4`, `dian hua`, `nü3`, `nv3`. */
export type PinyinQuery = {
  readonly key: string;
  readonly tones: readonly ToneAt[];
  /** Letters of the key followed by a space, an apostrophe or a hyphen: a syllable ends there. */
  readonly breaks: readonly number[];
};

const TONE_MARKS: ReadonlyMap<string, Tone> = new Map([
  ["̄", 1],
  ["́", 2],
  ["̌", 3],
  ["̀", 4],
]);
const TONE_NUMBERS: ReadonlyMap<string, Tone> = new Map([
  ["1", 1],
  ["2", 2],
  ["3", 3],
  ["4", 4],
  ["5", 5],
  ["0", 5],
]);
const DIAERESIS = "̈";
const CIRCUMFLEX = "̂";
const SEPARATORS = new Set([" ", "'", "’", "-"]);

/** Toneless search key of a numbered reading: lowercase letters only, ü as v (`nu:3 er2` → `nver`). */
export const searchKey = (reading: string): string =>
  reading
    .toLowerCase()
    .replace(/u:|ü/gu, "v")
    .replace(/ê/gu, "e")
    .replace(/[^a-z]/gu, "");

/** Reads a query as pinyin, or `null` when it holds anything but letters, tones and separators. */
export const parsePinyinQuery = (text: string): PinyinQuery | null => {
  let key = "";
  const tones: ToneAt[] = [];
  const breaks: number[] = [];
  // A tone or a letter modifier must follow a letter that has no tone yet.
  let afterLetter = false;
  for (const char of text.normalize("NFD").toLowerCase()) {
    const tone = TONE_MARKS.get(char) ?? TONE_NUMBERS.get(char) ?? null;
    if (/^[a-z]$/u.test(char)) {
      key += char;
      afterLetter = true;
    } else if ((char === DIAERESIS || char === ":") && afterLetter && key.endsWith("u")) {
      key = `${key.slice(0, -1)}v`;
    } else if (char === CIRCUMFLEX && afterLetter && key.endsWith("e")) {
      // ê is searched as e.
    } else if (tone !== null && afterLetter) {
      tones.push({ at: key.length - 1, tone, boundary: TONE_NUMBERS.has(char) });
      afterLetter = false;
    } else if (SEPARATORS.has(char)) {
      if (key !== "" && breaks.at(-1) !== key.length - 1) breaks.push(key.length - 1);
      afterLetter = false;
    } else {
      return null;
    }
  }
  return key === "" ? null : { key, tones, breaks };
};

type Span = { readonly start: number; readonly end: number; readonly tone: Tone | null };

/** Whether the syllables of a numbered reading carry the tones and breaks of the query, if any. */
export const matchesPinyin = (reading: string, query: PinyinQuery): boolean => {
  if (query.tones.length === 0 && query.breaks.length === 0) return true;
  const tokens = parseNumbered(reading);
  if (!tokens.ok) return false;
  const spans: Span[] = [];
  let start = 0;
  for (const token of tokens.value) {
    const syllable = token.kind === "syllable";
    const end = start + searchKey(syllable ? token.letters : token.text).length;
    spans.push({ start, end, tone: syllable ? token.tone : null });
    start = end;
  }
  return (
    query.tones.every(({ at, tone, boundary }) => {
      const span = spans.find((candidate) => candidate.start <= at && at < candidate.end);
      return span?.tone === tone && (!boundary || at === span.end - 1);
    }) && query.breaks.every((at) => spans.some((span) => span.end - 1 === at))
  );
};
