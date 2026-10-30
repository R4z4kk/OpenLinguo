import {
  coverage,
  knownWords,
  ok,
  type AnnotatedToken,
  type Coverage,
  type InvalidReading,
  type KnownWords,
  type LanguageId,
  type LookupError,
  type Occurrence,
  type ReadingChoices,
  type Result,
  type TextReadingFeature,
} from "@openlinguo/core";
import { readingKey } from "@openlinguo/lang-zh";
import type { Database, StoredText } from "./database.ts";
import { readLexicon } from "./lexicon.ts";
import { describeFailure, guarded, type ReviewLogFailure } from "./review-log.ts";

export type CoverageFailure = LookupError | InvalidReading;

/** The cards and « Je connais » marks of the language, and the names of the personal lexicon. */
export const loadKnownWords = (
  db: Database,
  language: LanguageId,
): Promise<Result<KnownWords, ReviewLogFailure>> =>
  guarded(async () =>
    ok(
      knownWords({
        language,
        cards: await db.cards.toArray(),
        marks: await db.knownMarks.toArray(),
        names: (await readLexicon(db)).names,
      }),
    ),
  );

const occurrenceOf = (
  token: AnnotatedToken,
  chosen: ReadingChoices,
): Result<Occurrence, InvalidReading> => {
  const picked = chosen[token.start];
  const reading =
    picked != null && token.readings.includes(picked) ? picked : (token.readings[0] ?? null);
  if (reading === null) return ok({ text: token.text, isWord: token.isWord, readingKey: null });
  const key = readingKey(reading);
  return key.ok ? ok({ text: token.text, isWord: token.isWord, readingKey: key.value }) : key;
};

/** Coverage, and the distinct words the dictionary lacks: they cannot be filed as cards. */
export type Measure = Coverage & { readonly unresolved: number };

/**
 * The words the learner can still learn: those of the text left out of the count are characters
 * outside the dictionary. Runs of one-character segments need the cascade of #229.
 */
export const wordsToLearn = ({ unknownWords, unresolved }: Measure): number =>
  unknownWords - unresolved;

/** The share of known word tokens, floored so that 97.6 % never reads 98 %; `total` is not 0. */
export const knownPercent = ({ known, total }: Pick<Measure, "known" | "total">): number =>
  Math.floor((100 * known) / total);

export const occurrencesOf = (
  tokens: readonly AnnotatedToken[],
  chosen: ReadingChoices,
): Result<readonly Occurrence[], InvalidReading> => {
  const occurrences: Occurrence[] = [];
  for (const token of tokens) {
    const occurrence = occurrenceOf(token, chosen);
    if (!occurrence.ok) return occurrence;
    occurrences.push(occurrence.value);
  }
  return ok(occurrences);
};

/** The distinct words with no dictionary entry, validated names apart. */
export const unresolvedWords = (
  occurrences: readonly Occurrence[],
  known: KnownWords,
): readonly string[] => [
  ...new Set(
    occurrences
      .filter(
        ({ text, isWord, readingKey: key }) => isWord && key === null && !known.names.has(text),
      )
      .map(({ text }) => text),
  ),
];

export const measureOccurrences = (
  occurrences: readonly Occurrence[],
  known: KnownWords,
): Measure => ({
  ...coverage(occurrences, known),
  unresolved: unresolvedWords(occurrences, known).length,
});

/** Known word tokens over word tokens of one text, with the readings the learner chose. */
export const measureText = async (
  feature: TextReadingFeature,
  known: KnownWords,
  { body, readingChoices }: Pick<StoredText, "body" | "readingChoices">,
  headwords: ReadonlySet<string> = new Set(),
): Promise<Result<Measure, CoverageFailure>> => {
  const tokens = await feature.annotate(body, headwords);
  if (!tokens.ok) return tokens;
  const occurrences = occurrencesOf(tokens.value, readingChoices);
  return occurrences.ok ? ok(measureOccurrences(occurrences.value, known)) : occurrences;
};

/** The detail shown in an error message. */
export const describeCoverageFailure = (failure: CoverageFailure | ReviewLogFailure): string => {
  switch (failure.kind) {
    case "dataset-missing":
      return failure.dataset;
    case "storage-failure":
      return failure.message;
    case "invalid-reading":
      return failure.reading;
    default:
      return describeFailure(failure);
  }
};
