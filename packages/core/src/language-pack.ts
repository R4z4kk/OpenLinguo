import type { Result } from "./result.ts";

export type LanguageId = "zh" | "en";

export type GlossLanguage = "en" | "fr";

export const proficiencyFrameworks = {
  "hsk-2025": ["1", "2", "3", "4", "5", "6", "7-9"],
  cefr: ["A1", "A2", "B1", "B2", "C1", "C2"],
} as const;

export type ProficiencyFramework = keyof typeof proficiencyFrameworks;

export type Token = {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly isWord: boolean;
};

export type Gloss = { readonly lang: GlossLanguage; readonly text: string };

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
  readonly tonesOf: (reading: string) => Result<readonly number[], InvalidReading>;
};

export type DecompositionNode = {
  readonly form: string;
  readonly glosses: readonly Gloss[];
  readonly children: readonly DecompositionNode[];
};

export type DecompositionFeature = {
  readonly decompose: (word: string) => Promise<Result<DecompositionNode, LookupError>>;
};

export type StrokeData = {
  readonly strokes: readonly string[];
  readonly medians: readonly (readonly (readonly [number, number])[])[];
};

export type StrokeFeature = {
  readonly strokesOf: (character: string) => Promise<Result<StrokeData, LookupError>>;
};

export type LanguageFeatures = {
  readonly tones: ToneFeature | null;
  readonly strokes: StrokeFeature | null;
  readonly romanization: RomanizationFeature | null;
  readonly decomposition: DecompositionFeature | null;
};

export type FeatureName = keyof LanguageFeatures;

export type LanguagePack = {
  readonly id: LanguageId;
  readonly proficiency: ProficiencyFramework;
  readonly tokenize: (text: string) => readonly Token[];
  readonly lookup: DictionaryLookup;
  readonly features: LanguageFeatures;
};
