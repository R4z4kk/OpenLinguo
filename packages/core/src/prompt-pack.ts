import type { z } from "zod";
import type { GlossLanguage, InvalidReading, LookupError } from "./language-pack.ts";
import type { Result } from "./result.ts";

export type ChatMessage = { readonly role: "system" | "user"; readonly content: string };

export type PromptTask<Input, Answer> = {
  /** Versioned, such as `zh-correct-v1`: the `promptVersion` in the provenance of every output. */
  readonly id: string;
  readonly messages: (input: Input) => readonly ChatMessage[];
  /** Per input, so that counts and indices are checked: one answer per sentence or per sense. */
  readonly schema: (input: Input) => z.ZodType<Answer>;
};

export type CorrectionInput = {
  /** The word the learner practises, `null` for free writing. */
  readonly word: string | null;
  readonly sentences: readonly string[];
  /** Language of the explanations and meanings: the interface's. */
  readonly language: GlossLanguage;
};

/** `from` is empty for an insertion, `to` for a removal. */
export type CorrectionChange = {
  readonly from: string;
  readonly to: string;
  readonly explanation: string;
};

export type CorrectedSentence = {
  /** 1-based position of the sentence in the input: answers may come in any order. */
  readonly index: number;
  readonly corrected: string;
  readonly changes: readonly CorrectionChange[];
  readonly reading: string;
  readonly meaning: string;
};

export type CorrectionAnswer = { readonly sentences: readonly CorrectedSentence[] };

export type VocabularyInput = {
  readonly themes: readonly string[];
  readonly note: string;
  /** 1-based rank in the pack's proficiency framework. */
  readonly level: number;
  readonly count: number;
};

export type VocabularyAnswer = { readonly headwords: readonly string[] };

export type GlossInput = {
  readonly headword: string;
  readonly reading: string;
  /** English senses, in order. */
  readonly glosses: readonly string[];
};

/** One French gloss per English sense, in the same order. */
export type GlossAnswer = { readonly glosses: readonly string[] };

export type ReadingMismatch = {
  /** UTF-16 offsets of the character in the text, as in `Token`. */
  readonly start: number;
  readonly end: number;
  /** Numbered syllable, as written. */
  readonly written: string;
  /** The dictionary's readings of the character there; empty when it has none. */
  readonly readings: readonly string[];
};

export type ReadingCheckError = InvalidReading | LookupError;

export type PromptPack = {
  readonly correction: PromptTask<CorrectionInput, CorrectionAnswer>;
  readonly vocabulary: PromptTask<VocabularyInput, VocabularyAnswer>;
  readonly glossTranslation: PromptTask<GlossInput, GlossAnswer>;
  /** Flags the syllables of an AI reading that the dictionary does not give; never fixes them. */
  readonly checkReading: (
    text: string,
    reading: string,
  ) => Promise<Result<readonly ReadingMismatch[], ReadingCheckError>>;
};
