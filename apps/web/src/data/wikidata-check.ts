import {
  lookupWikidata,
  ok,
  type Result,
  type WikidataCandidate,
  type WikidataError,
  type WikidataKind,
} from "@openlinguo/core";
import type { Database } from "./database.ts";
import type { Found, LexiconKind } from "./lexicon.ts";
import { saveResolution } from "./resolutions.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";
import type { UnknownWord } from "./unknown-words.ts";

/** An item that is none of the three is still a proper name, of a kind Wikidata does not tell here. */
const KINDS: Readonly<Record<WikidataKind, LexiconKind>> = {
  person: "person",
  place: "place",
  organization: "organization",
  other: "name",
};

/** The sequences to send: the eligible ones that Wikidata has not answered yet. */
export const toCheck = (words: readonly UnknownWord[]): readonly string[] =>
  words
    .filter(
      ({ wikidata, checks }) => wikidata && !checks.some(({ source }) => source === "wikidata"),
    )
    .map(({ text }) => text);

/** The description in the interface language, else in the other one. */
export const foundOf = (
  { id, kind, descriptionFr, descriptionEn }: WikidataCandidate,
  language: string,
): Found => {
  const descriptions = language.startsWith("fr")
    ? [descriptionFr, descriptionEn]
    : [descriptionEn, descriptionFr];
  return {
    kind: KINDS[kind],
    reading: null,
    gloss: descriptions.find((description) => description !== null && description !== "") ?? null,
    reference: id,
    provenance: null,
  };
};

export type WikidataOutcome = {
  /** Sequences answered and kept, with or without a result. */
  readonly answered: readonly string[];
  /** Of those, the ones with at least one result. */
  readonly found: number;
  readonly error: WikidataError | null;
};

/**
 * Asks Wikidata and keeps every answer, found or not. After an error, the batches already answered
 * are kept and the rest was not sent.
 */
export const checkOnWikidata = async (
  db: Database,
  sequences: readonly string[],
  language: string,
  signal: AbortSignal,
  now: number = Date.now(),
  send: typeof fetch = fetch,
): Promise<Result<WikidataOutcome, ReviewLogFailure>> => {
  const lookup = await lookupWikidata({ sequences, fetch: send, signal });
  return guarded(async () => {
    for (const { sequence, candidates } of lookup.checked) {
      const saved = await saveResolution(db, {
        sequence,
        source: "wikidata",
        found: candidates.map((candidate) => foundOf(candidate, language)),
        checkedAt: now,
      });
      if (!saved.ok) return saved;
    }
    return ok({
      answered: lookup.checked.map(({ sequence }) => sequence),
      found: lookup.checked.filter(({ candidates }) => candidates.length > 0).length,
      error: lookup.error,
    });
  });
};

/** Once the learner confirmed the notice before the first call; on this device only. */
export const wikidataNoticeSeen = (db: Database): Promise<Result<boolean, ReviewLogFailure>> =>
  guarded(async () => ok((await db.aiNotice.get("wikidata")) != null));

export const markWikidataNoticeSeen = (db: Database): Promise<Result<null, ReviewLogFailure>> =>
  guarded(async () => {
    await db.aiNotice.put({ id: "wikidata" });
    return ok(null);
  });
