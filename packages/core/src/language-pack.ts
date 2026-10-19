import type { PromptPack } from "./prompt-pack.ts";
import type { Result } from "./result.ts";

export const LANGUAGE_IDS = ["zh", "en"] as const;

export type LanguageId = (typeof LANGUAGE_IDS)[number];

export type GlossLanguage = "en" | "fr";

export const proficiencyFrameworks = {
  "hsk-2025": ["1", "2", "3", "4", "5", "6", "7-9"],
  "gf0025-2021": ["1", "2", "3", "4", "5", "6", "7-9"],
  cefr: ["A1", "A2", "B1", "B2", "C1", "C2"],
} as const;

export type ProficiencyFramework = keyof typeof proficiencyFrameworks;

export type Token = {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly isWord: boolean;
};

/** `source` names the dataset the gloss comes from, shown with it (attribution, CC BY-SA). */
export type Gloss = {
  readonly lang: GlossLanguage;
  readonly text: string;
  readonly source: string;
};

export type DictEntry = {
  readonly headword: string;
  readonly variants: readonly string[];
  readonly reading: string | null;
  readonly glosses: readonly Gloss[];
  /** 1-based rank in the pack's proficiency framework. */
  readonly level: number | null;
};

export type LookupError =
  | { readonly kind: "dataset-missing"; readonly dataset: string }
  | { readonly kind: "storage-failure"; readonly message: string };

export type DictionaryLookup = (term: string) => Promise<Result<readonly DictEntry[], LookupError>>;

export type InvalidReading = { readonly kind: "invalid-reading"; readonly reading: string };

export type RomanizationFeature = {
  readonly system: string;
  readonly toDisplay: (reading: string) => Result<string, InvalidReading>;
};

export type ToneFeature = {
  readonly tonesOf: (reading: string) => Result<readonly (number | null)[], InvalidReading>;
};

export type DecompositionNode = {
  readonly form: string;
  readonly glosses: readonly Gloss[];
  readonly children: readonly DecompositionNode[];
};

export type DecompositionFeature = {
  readonly decompose: (word: string) => Promise<Result<DecompositionNode, LookupError>>;
};

/** Stroke outlines (SVG paths) and medians, in order, in a 1024-unit box with y up. */
export type StrokeData = {
  readonly strokes: readonly string[];
  readonly medians: readonly (readonly (readonly [number, number])[])[];
};

export type StrokeFeature = {
  /** `null` when the character has no stroke data. */
  readonly strokesOf: (character: string) => Promise<Result<StrokeData | null, LookupError>>;
};

/** A word the input method offers for the start of the input. */
export type ImeCandidate = {
  readonly text: string;
  /** UTF-16 code units of the input it replaces, from the start: committing it leaves `input.slice(consumed)`. */
  readonly consumed: number;
};

export type ImeError =
  | LookupError
  /** Nothing at the start of the input can be typed: empty, or not a syllable of the language. */
  | { readonly kind: "unknown-input"; readonly input: string }
  /** The input reads as syllables, but no word has them (with the tones typed). */
  | { readonly kind: "no-match"; readonly input: string };

export type ImeFeature = {
  /** Words for the start of the input, best first: never an empty list. */
  readonly candidates: (
    input: string,
  ) => Promise<Result<readonly [ImeCandidate, ...ImeCandidate[]], ImeError>>;
};

export type LanguageFeatures = {
  readonly tones: ToneFeature | null;
  readonly strokes: StrokeFeature | null;
  readonly romanization: RomanizationFeature | null;
  readonly decomposition: DecompositionFeature | null;
  readonly ime: ImeFeature | null;
};

export type FeatureName = keyof LanguageFeatures;

export type LanguagePack = {
  readonly id: LanguageId;
  readonly proficiency: ProficiencyFramework;
  readonly tokenize: (text: string) => readonly Token[];
  readonly lookup: DictionaryLookup;
  readonly features: LanguageFeatures;
  /** AI prompts, `null` until the language has them. */
  readonly prompts: PromptPack | null;
};
