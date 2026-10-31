import type { AnnotatedToken } from "@openlinguo/core";

const HAN = /\p{Script=Han}/u;
const TERMINATOR = /[。！？；!?;\n]/u;
const CLOSER = /[”’」』）)》】\]]/u;
/** A text without punctuation is one sentence: keep what is around the sequence. */
const CONTEXT_MAX = 60;

/** A sequence of characters the dictionary does not cover, at its first place in the text. */
export type UnknownSequence = {
  readonly text: string;
  /** UTF-16 offsets in the text, as `Token`. */
  readonly start: number;
  readonly end: number;
  /** Made only of common words: usually compositional (他|也|是), not for Wikidata. */
  readonly compositional: boolean;
};

const isSingleHan = ({ text }: AnnotatedToken): boolean =>
  HAN.test(text) && Array.from(text).length === 1;

/**
 * Runs of one-character segments (王|小|红) and characters outside the dictionary. A run of only
 * common words (`isCommon`: HSK 1–3) is kept whole and flagged; any other loses the common words at
 * its edges, and is dropped when a single dictionary character is all that remains. Each distinct
 * sequence comes once.
 */
export const findUnknownSequences = (
  tokens: readonly AnnotatedToken[],
  isCommon: (word: string) => boolean,
): readonly UnknownSequence[] => {
  const found = new Map<string, UnknownSequence>();
  const keep = (run: readonly AnnotatedToken[]): void => {
    const common = run.map(({ text }) => isCommon(text));
    const compositional = common.every(Boolean);
    let from = 0;
    let to = run.length;
    if (!compositional) {
      while (common[from] === true) from++;
      while (common[to - 1] === true) to--;
    }
    const kept = run.slice(from, to);
    const first = kept[0];
    const last = kept.at(-1);
    if (first == null || last == null) return;
    if (kept.length === 1 && first.readings.length > 0) return;
    const text = kept.map((token) => token.text).join("");
    if (!found.has(text))
      found.set(text, { text, start: first.start, end: last.end, compositional });
  };

  let run: AnnotatedToken[] = [];
  const flush = (): void => {
    if (run.length > 0) keep(run);
    run = [];
  };
  for (const token of tokens) {
    if (isSingleHan(token)) run.push(token);
    else flush();
  }
  flush();
  return [...found.values()];
};

const shorten = (text: string, limit: number): string => {
  const characters = Array.from(text);
  if (characters.length <= Math.abs(limit)) return text;
  return limit < 0
    ? `…${characters.slice(limit).join("")}`
    : `${characters.slice(0, limit).join("")}…`;
};

/** The sentence around `[start, end)` as the text before and after it, ends trimmed, cut at 60 characters. */
export const sentenceAround = (
  body: string,
  start: number,
  end: number,
): { readonly before: string; readonly after: string } => {
  let from = start;
  while (from > 0 && !TERMINATOR.test(body.charAt(from - 1))) from--;
  // Closing marks after a final stop belong to the sentence before.
  while (from < start && CLOSER.test(body.charAt(from))) from++;
  let to = end;
  while (to < body.length && !TERMINATOR.test(body.charAt(to))) to++;
  if (to < body.length && body.charAt(to) !== "\n") {
    to++;
    while (to < body.length && CLOSER.test(body.charAt(to))) to++;
  }
  return {
    before: shorten(body.slice(from, start).trimStart(), -CONTEXT_MAX),
    after: shorten(body.slice(end, to).trimEnd(), CONTEXT_MAX),
  };
};
