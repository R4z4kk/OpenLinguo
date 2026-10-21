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

/** What a proper name is: a story lists these, and an explanation may answer one. */
export type NameKind = "person" | "place" | "organization";

export type SequenceKind = NameKind | "word" | "not-a-word";

export type ExplainInput = {
  /** Each unknown sequence with the sentence of the text it comes from. */
  readonly sequences: readonly { readonly sequence: string; readonly sentence: string }[];
  /** Language of the meanings: the interface's. */
  readonly language: GlossLanguage;
};

export type ExplainedSequence = {
  /** 1-based position of the sequence in the input: answers may come in any order. */
  readonly index: number;
  readonly kind: SequenceKind;
  /** Short; empty only for `not-a-word`. */
  readonly meaning: string;
};

export type ExplainAnswer = { readonly sequences: readonly ExplainedSequence[] };

export type StoryLength = "short" | "medium";

export type StoryInput = {
  /** 1-based rank in the pack's proficiency framework: the learner's learning band. */
  readonly band: number;
  readonly theme: string;
  readonly length: StoryLength;
  /** Words in the learner's learning steps to use again, at most 20: the caller picks them. */
  readonly words: readonly string[];
};

export type StoryName = { readonly text: string; readonly kind: NameKind };

export type StoryAnswer = {
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly names: readonly StoryName[];
};

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
  readonly explanation: PromptTask<ExplainInput, ExplainAnswer>;
  readonly story: PromptTask<StoryInput, StoryAnswer>;
  /** Flags the syllables of an AI reading that the dictionary does not give; never fixes them. */
  readonly checkReading: (
    text: string,
    reading: string,
  ) => Promise<Result<readonly ReadingMismatch[], ReadingCheckError>>;
};
