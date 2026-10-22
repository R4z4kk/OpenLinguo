import {
  knowledgeOf,
  ok,
  type AnnotatedToken,
  type InvalidReading,
  type Knowledge,
  type KnownWords,
  type LookupError,
  type ReadingChoices,
  type Result,
  type TextReadingError,
  type TextReadingFeature,
} from "@openlinguo/core";
import type { Database } from "./database.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";
import {
  measureOccurrences,
  occurrencesOf,
  unresolvedWords,
  type Measure,
} from "./text-coverage.ts";

/** Every lookup of the text in one read transaction: one per word is what makes WebKit slow. */
export const annotateText = (
  db: Database,
  feature: TextReadingFeature,
  body: string,
): Promise<Result<readonly AnnotatedToken[], LookupError | ReviewLogFailure>> =>
  guarded(() => db.transaction("r", db.entries, () => feature.annotate(body)));

const OPENING = /^[\p{Ps}\p{Pi}]+$/u;
const CLOSING = /^[\p{Pe}\p{Pf}\p{Po}]+$/u;

/**
 * A run of the passage: plain text, or a word (an index in the tokens) with the punctuation that
 * must stay on its line (an opening mark before it, closing marks after it).
 */
export type PassageItem =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "word";
      readonly index: number;
      readonly before: string;
      readonly after: string;
    };

export type Paragraph = readonly PassageItem[];

/** The paragraphs of a text, split on line breaks, empty ones left out. */
export const paragraphsOf = (tokens: readonly AnnotatedToken[]): readonly Paragraph[] => {
  const paragraphs: PassageItem[][] = [];
  let items: PassageItem[] = [];
  let opening = "";
  const flushOpening = (): void => {
    if (opening !== "") items.push({ kind: "text", text: opening });
    opening = "";
  };
  const endParagraph = (): void => {
    flushOpening();
    if (items.some((item) => item.kind === "word" || item.text.trim() !== ""))
      paragraphs.push(items);
    items = [];
  };
  for (const [index, token] of tokens.entries()) {
    if (token.text === "\n") endParagraph();
    else if (token.isWord) {
      items.push({ kind: "word", index, before: opening, after: "" });
      opening = "";
    } else if (OPENING.test(token.text)) opening += token.text;
    else {
      const last = items.at(-1);
      if (opening === "" && last?.kind === "word" && CLOSING.test(token.text))
        items[items.length - 1] = { ...last, after: last.after + token.text };
      else {
        flushOpening();
        items.push({ kind: "text", text: token.text });
      }
    }
  }
  endParagraph();
  return paragraphs;
};

/** What the reader draws, all recomputed from the tokens when the known words or readings change. */
export type ReaderView = {
  readonly paragraphs: readonly Paragraph[];
  /** Per token. */
  readonly knowledge: readonly Knowledge[];
  /** Spoken pinyin per token, `null` when the text cannot be read aloud as pinyin. */
  readonly spoken: readonly (string | null)[] | null;
  readonly pinyinFailure: TextReadingError | null;
  readonly measure: Measure;
  /** The distinct words the dictionary lacks. */
  readonly unresolved: readonly string[];
};

export const readerView = (
  feature: TextReadingFeature,
  tokens: readonly AnnotatedToken[],
  known: KnownWords,
  choices: ReadingChoices,
): Result<ReaderView, InvalidReading> => {
  const occurrences = occurrencesOf(tokens, choices);
  if (!occurrences.ok) return occurrences;
  const spoken = feature.pinyin(tokens, choices);
  return ok({
    paragraphs: paragraphsOf(tokens),
    knowledge: occurrences.value.map((occurrence) => knowledgeOf(known, occurrence)),
    spoken: spoken.ok ? spoken.value : null,
    pinyinFailure: spoken.ok ? null : spoken.error,
    measure: measureOccurrences(occurrences.value, known),
    unresolved: unresolvedWords(occurrences.value, known),
  });
};

/** Points missing to reach the target, from the floored percentage. */
export const gapToTarget = (percent: number, target: number): number =>
  Math.max(0, target - percent);
