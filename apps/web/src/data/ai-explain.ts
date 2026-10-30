import {
  ok,
  type AiProvenance,
  type ExplainAnswer,
  type ExplainInput,
  type GlossLanguage,
  type Result,
} from "@openlinguo/core";
import type { Database } from "./database.ts";
import type { Found } from "./lexicon.ts";
import type { Resolution } from "./resolutions.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";
import type { UnknownWord } from "./unknown-words.ts";

/** Sequences sent by one click; the next click sends the next ones. */
export const EXPLAIN_MAX = 50;

/**
 * An AI answer to « Ask the AI » has a meaning, or found nothing for « not a word »; a story name
 * (no meaning) is not one.
 */
const explained = ({ proposals, checks }: UnknownWord): boolean =>
  checks.some(({ source, found }) => source === "ai" && found === 0) ||
  proposals.some(({ source, gloss }) => source === "ai" && gloss !== null);

/** The sequences still to send, the likely names and new words before the runs of common words. */
export const unexplained = (words: readonly UnknownWord[]): readonly UnknownWord[] =>
  [
    ...words.filter(({ compositional }) => !compositional),
    ...words.filter(({ compositional }) => compositional),
  ].filter((word) => !explained(word));

/** What one press sends: the first `EXPLAIN_MAX` sequences, each with its sentence. */
export const explainInput = (
  words: readonly UnknownWord[],
  language: GlossLanguage,
): ExplainInput => ({
  sequences: words.slice(0, EXPLAIN_MAX).map(({ text, before, after }) => ({
    sequence: text,
    sentence: `${before}${text}${after}`,
  })),
  language,
});

/**
 * Keeps every answer as the AI's, replacing an earlier one (a story name included): « not a word »
 * found nothing, anything else is one proposal with its meaning.
 */
export const saveExplanations = (
  db: Database,
  input: ExplainInput,
  { sequences }: ExplainAnswer,
  provenance: AiProvenance,
  at: number,
): Promise<Result<number, ReviewLogFailure>> =>
  guarded(async () => {
    const rows = sequences.flatMap(({ index, kind, meaning }): Resolution[] => {
      const sent = input.sequences[index - 1];
      if (sent == null) return [];
      const found: Found[] =
        kind === "not-a-word"
          ? []
          : [{ kind, reading: null, gloss: meaning.trim(), reference: null, provenance }];
      return [{ sequence: sent.sequence, source: "ai", found, checkedAt: at }];
    });
    await db.transaction("rw", db.resolutions, () => db.resolutions.bulkPut(rows));
    return ok(rows.length);
  });
