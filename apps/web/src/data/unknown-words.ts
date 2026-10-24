import {
  isWikidataSequence,
  ok,
  type AnnotatedToken,
  type LanguageId,
  type LookupError,
  type Result,
  type TextReadingFeature,
} from "@openlinguo/core";
import { findUnknownSequences, sentenceAround, type UnknownSequence } from "@openlinguo/lang-zh";
import type { Database, StoredText } from "./database.ts";
import { lookupExtended } from "./extended-lexicon.ts";
import type { Proposal } from "./lexicon.ts";
import { lookupNameKinds } from "./names.ts";
import { annotateText } from "./reader.ts";
import { loadResolutions, type Resolution } from "./resolutions.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";
import {
  loadKnownWords,
  measureOccurrences,
  occurrencesOf,
  type CoverageFailure,
  type Measure,
} from "./text-coverage.ts";

/** The levels of the 2025 syllabus whose words are too common to be a name or a coined word. */
const COMMON_MAX_LEVEL = 3;

export type UnknownWordsFailure = LookupError | ReviewLogFailure;

/** An answer a source kept, found or not. */
export type Check = {
  readonly source: Resolution["source"];
  readonly checkedAt: number;
  readonly found: number;
};

export type UnknownWord = UnknownSequence & {
  readonly before: string;
  readonly after: string;
  /** Can be sent to Wikidata (#230). */
  readonly wikidata: boolean;
  /** In the order of the cascade. */
  readonly proposals: readonly Proposal[];
  readonly checks: readonly Check[];
};

/** The words of HSK 2025 levels 1 to 3 among these, whatever referential the learner follows. */
export const commonWords = (
  db: Database,
  words: readonly string[],
): Promise<Result<ReadonlySet<string>, ReviewLogFailure>> =>
  guarded(async () => {
    const entries = await db.entries
      .where("simplified")
      .anyOf(words)
      .filter(({ hsk2025 }) => hsk2025 !== null && hsk2025 <= COMMON_MAX_LEVEL)
      .toArray();
    return ok(new Set(entries.map(({ simplified }) => simplified)));
  });

type Cached = { readonly proposals: readonly Proposal[]; readonly checks: readonly Check[] };

/** Step 2: what an earlier request found for the sequences, and the ones that found nothing. */
export const fromCache = async (
  db: Database,
  sequences: readonly string[],
): Promise<Result<ReadonlyMap<string, Cached>, ReviewLogFailure>> => {
  const resolutions = await loadResolutions(db, sequences);
  if (!resolutions.ok) return resolutions;
  const cached = new Map<string, Cached>();
  for (const { sequence, source, found, checkedAt } of resolutions.value.toSorted(
    (a, b) => a.checkedAt - b.checkedAt,
  )) {
    const before = cached.get(sequence) ?? { proposals: [], checks: [] };
    cached.set(sequence, {
      proposals: [...before.proposals, ...found.map((item) => ({ ...item, source }))],
      checks: [...before.checks, { source, checkedAt, found: found.length }],
    });
  }
  return ok(cached);
};

/** Step 3, a proposal only: the words English Wiktionary has and CC-CEDICT lacks. */
export const fromExtendedLexicon = async (
  db: Database,
  sequences: readonly string[],
): Promise<Result<ReadonlyMap<string, readonly Proposal[]>, LookupError>> => {
  const proposals = new Map<string, readonly Proposal[]>();
  for (const sequence of sequences) {
    const words = await lookupExtended(db, sequence);
    if (!words.ok) return words;
    if (words.value.length > 0)
      proposals.set(
        sequence,
        words.value.map(({ pos, reading, glosses }) => ({
          source: "extended-lexicon",
          kind: pos === "name" ? "name" : "word",
          reading,
          gloss: glosses.join("; "),
          reference: null,
          provenance: null,
        })),
      );
  }
  return ok(proposals);
};

/** Step 4, a proposal only: the kind jieba tags the sequence with, no meaning. */
export const fromNameSignal = async (
  db: Database,
  sequences: readonly string[],
): Promise<Result<ReadonlyMap<string, readonly Proposal[]>, LookupError>> => {
  const proposals = new Map<string, readonly Proposal[]>();
  for (const sequence of sequences) {
    const kinds = await lookupNameKinds(db, sequence);
    if (!kinds.ok) return kinds;
    if (kinds.value.length > 0)
      proposals.set(
        sequence,
        kinds.value.map((kind) => ({
          source: "name-signal",
          kind,
          reading: null,
          gloss: null,
          reference: null,
          provenance: null,
        })),
      );
  }
  return ok(proposals);
};

/**
 * Runs the steps after the personal lexicon, which the segmenter has already applied: a run of
 * common words the extended lexicon has is no longer set apart as compositional.
 */
export const resolveUnknownWords = async (
  db: Database,
  body: string,
  sequences: readonly UnknownSequence[],
): Promise<Result<readonly UnknownWord[], UnknownWordsFailure>> => {
  const texts = sequences.map(({ text }) => text);
  const cached = await fromCache(db, texts);
  if (!cached.ok) return cached;
  const extended = await fromExtendedLexicon(db, texts);
  if (!extended.ok) return extended;
  const names = await fromNameSignal(db, texts);
  if (!names.ok) return names;
  return ok(
    sequences.map((found) => {
      const answered = cached.value.get(found.text);
      const listed = extended.value.get(found.text) ?? [];
      const compositional = found.compositional && listed.length === 0;
      return {
        ...found,
        ...sentenceAround(body, found.start, found.end),
        compositional,
        wikidata: !compositional && isWikidataSequence(found.text),
        proposals: [
          ...(answered?.proposals ?? []),
          ...listed,
          ...(names.value.get(found.text) ?? []),
        ],
        checks: answered?.checks ?? [],
      };
    }),
  );
};

/** The unknown words of an annotated text, each with the proposals of the local steps. */
export const listUnknownWords = async (
  db: Database,
  body: string,
  tokens: readonly AnnotatedToken[],
): Promise<Result<readonly UnknownWord[], UnknownWordsFailure>> => {
  const singles = new Set(
    tokens
      .filter(({ isWord, text }) => isWord && Array.from(text).length === 1)
      .map(({ text }) => text),
  );
  const common = await commonWords(db, [...singles]);
  if (!common.ok) return common;
  return resolveUnknownWords(
    db,
    body,
    findUnknownSequences(tokens, (word) => common.value.has(word)),
  );
};

/** The coverage of a text as it reads now: cards, marks and the personal lexicon, text split again. */
export const currentMeasure = async (
  db: Database,
  feature: TextReadingFeature,
  language: LanguageId,
  { body, readingChoices }: Pick<StoredText, "body" | "readingChoices">,
): Promise<Result<Measure, CoverageFailure | ReviewLogFailure>> => {
  const [known, tokens] = await Promise.all([
    loadKnownWords(db, language),
    annotateText(db, feature, body),
  ]);
  if (!known.ok) return known;
  if (!tokens.ok) return tokens;
  const occurrences = occurrencesOf(tokens.value, readingChoices);
  return occurrences.ok ? ok(measureOccurrences(occurrences.value, known.value)) : occurrences;
};
