import { err, ok, type InvalidReading, type Result } from "@openlinguo/core";

/** 5 is the neutral tone, as in CC-CEDICT. */
export type Tone = 1 | 2 | 3 | 4 | 5;

export type ReadingToken =
  | { readonly kind: "syllable"; readonly letters: string; readonly tone: Tone }
  | { readonly kind: "other"; readonly text: string };

const SYLLABLE =
  /^(?:(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(?:iang|iong|uang|ueng|iao|ian|uai|uan|üan|ang|eng|ong|ing|ai|ei|ao|ou|an|en|er|ia|ie|iu|in|io|ua|uo|ui|un|üe|ue|ün|a|o|e|ê|i|u|ü)|m|n|ng|hm|hng|r)$/u;
const NUMBERED = /^([A-Za-zÜüÊê:]+)(\d)$/u;
const TONE_MARKS = ["̄", "́", "̌", "̀"];
const TONE_MARK = /[̄́̌̀]/gu;

const invalid = (reading: string): InvalidReading => ({ kind: "invalid-reading", reading });

const isTone = (value: number): value is Tone =>
  Number.isInteger(value) && value >= 1 && value <= 5;

const normalizeLetters = (letters: string): string =>
  letters.replace(/u:|v/gu, "ü").replace(/U:|V/gu, "Ü");

const isSyllable = (letters: string): boolean => SYLLABLE.test(letters.toLowerCase());

export const parseNumbered = (reading: string): Result<readonly ReadingToken[], InvalidReading> => {
  const tokens: ReadingToken[] = [];
  for (const text of reading.split(" ")) {
    if (text === "") return err(invalid(reading));
    const match = NUMBERED.exec(text);
    if (match?.[1] == null || match[2] == null) {
      tokens.push({ kind: "other", text });
      continue;
    }
    const letters = normalizeLetters(match[1]);
    const tone = Number(match[2]);
    if (!isTone(tone) || !isSyllable(letters)) return err(invalid(reading));
    tokens.push({ kind: "syllable", letters, tone });
  }
  return ok(tokens);
};

export const formatNumbered = (tokens: readonly ReadingToken[]): string =>
  tokens
    .map((token) =>
      token.kind === "syllable"
        ? `${token.letters.replace(/ü/gu, "u:").replace(/Ü/gu, "U:")}${String(token.tone)}`
        : token.text,
    )
    .join(" ");

const markIndex = (letters: string): number => {
  const lower = letters.toLowerCase();
  for (const vowel of ["a", "e", "ê"]) {
    if (lower.includes(vowel)) return lower.indexOf(vowel);
  }
  if (lower.includes("ou")) return lower.indexOf("o");
  const lastVowel = Math.max(...["i", "o", "u", "ü"].map((vowel) => lower.lastIndexOf(vowel)));
  return lastVowel >= 0 ? lastVowel : lower.search(/[mn]/u);
};

const markTone = (letters: string, tone: Tone): string | null => {
  if (tone === 5) return letters;
  const index = markIndex(letters);
  const mark = TONE_MARKS[tone - 1];
  if (index < 0 || mark == null) return null;
  return `${letters.slice(0, index + 1)}${mark}${letters.slice(index + 1)}`.normalize("NFC");
};

export const toDiacritic = (reading: string): Result<string, InvalidReading> => {
  const tokens = parseNumbered(reading);
  if (!tokens.ok) return tokens;
  const parts: string[] = [];
  for (const token of tokens.value) {
    const part = token.kind === "syllable" ? markTone(token.letters, token.tone) : token.text;
    if (part === null) return err(invalid(reading));
    parts.push(part);
  }
  return ok(parts.join(" "));
};

export const toNumbered = (text: string): Result<string, InvalidReading> => {
  const tokens: ReadingToken[] = [];
  for (const part of text.split(" ")) {
    if (part === "") return err(invalid(text));
    const decomposed = part.normalize("NFD");
    const marks = decomposed.match(TONE_MARK) ?? [];
    const letters = normalizeLetters(decomposed.replace(TONE_MARK, "").normalize("NFC"));
    const syllable = /^[A-Za-zÜüÊê]+$/u.test(letters) && isSyllable(letters);
    if (marks.length > 1 || (marks.length === 1 && !syllable)) return err(invalid(text));
    if (!syllable) {
      tokens.push({ kind: "other", text: part });
      continue;
    }
    const tone = marks[0] == null ? 5 : TONE_MARKS.indexOf(marks[0]) + 1;
    if (!isTone(tone)) return err(invalid(text));
    tokens.push({ kind: "syllable", letters, tone });
  }
  return ok(formatNumbered(tokens));
};

export const tonesOf = (reading: string): Result<readonly (Tone | null)[], InvalidReading> => {
  const tokens = parseNumbered(reading);
  if (!tokens.ok) return tokens;
  return ok(tokens.value.map((token) => (token.kind === "syllable" ? token.tone : null)));
};
