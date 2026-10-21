import {
  coverage,
  err,
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
import { describeFailure, guarded, type ReviewLogFailure } from "./review-log.ts";

export type CoverageFailure = LookupError | InvalidReading;

/** The cards and « Je connais » marks of the language; validated names join with the lexicon (#229). */
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
        names: [],
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

/** Known word tokens over word tokens of one text, with the readings the learner chose. */
export const measureText = async (
  feature: TextReadingFeature,
  known: KnownWords,
  { body, readingChoices }: Pick<StoredText, "body" | "readingChoices">,
): Promise<Result<Measure, CoverageFailure>> => {
  const tokens = await feature.annotate(body);
  if (!tokens.ok) return tokens;
  const occurrences: Occurrence[] = [];
  for (const token of tokens.value) {
    const occurrence = occurrenceOf(token, readingChoices);
    if (!occurrence.ok) return err(occurrence.error);
    occurrences.push(occurrence.value);
  }
  const unresolved = new Set(
    occurrences
      .filter(
        ({ text, isWord, readingKey: key }) => isWord && key === null && !known.names.has(text),
      )
      .map(({ text }) => text),
  );
  return ok({ ...coverage(occurrences, known), unresolved: unresolved.size });
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
