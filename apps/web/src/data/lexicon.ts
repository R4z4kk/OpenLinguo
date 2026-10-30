import { AiProvenance, err, ok, type InvalidReading, type Result } from "@openlinguo/core";
import { parseNumbered, readingKey } from "@openlinguo/lang-zh";
import { z } from "zod";
import type { Database } from "./database.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

/** `name`: a proper name of a kind the source does not tell. */
export const LEXICON_KINDS = ["person", "place", "organization", "name", "word"] as const;
export const LexiconKind = z.enum(LEXICON_KINDS);
export type LexiconKind = z.output<typeof LexiconKind>;

/** Where a proposal comes from: the first two are local, the others are asked for (#230, #231). */
export const PROPOSAL_SOURCES = ["extended-lexicon", "name-signal", "wikidata", "ai"] as const;
export const ProposalSource = z.enum(PROPOSAL_SOURCES);
export type ProposalSource = z.output<typeof ProposalSource>;

/** What a source says a sequence is. Nothing in it is applied before the learner validates it. */
export const Found = z.object({
  kind: LexiconKind,
  /** Numbered pinyin, as the dictionary's readings. */
  reading: z.string().min(1).nullable(),
  gloss: z.string().min(1).nullable(),
  /** The item id at the source, to check the answer there (Wikidata: `Q42`). */
  reference: z.string().min(1).nullable().default(null),
  /** Set when the answer came from an AI (docs/compliance/ai.md §4). */
  provenance: AiProvenance.nullable(),
});
export type Found = z.output<typeof Found>;

export type Proposal = Found & { readonly source: ProposalSource };

/** A sequence the learner validated: segmented as one word and, for a name, counted as known. */
export const LexiconEntry = z.object({
  headword: z.string().min(1),
  kind: LexiconKind,
  reading: z.string().min(1).nullable(),
  gloss: z.string().min(1).nullable(),
  /** The proposal's source, or `learner` for an entry typed in. */
  source: z.enum([...PROPOSAL_SOURCES, "learner"]),
  provenance: AiProvenance.nullable(),
  validatedAt: z.number().int().nonnegative(),
});
export type LexiconEntry = z.output<typeof LexiconEntry>;

/** An entry that is checked and not yet kept: `acceptEntry` dates it. */
export type NewEntry = Omit<LexiconEntry, "validatedAt">;

/** Segmenting tries every length up to the longest headword at every position. */
export const HEADWORD_MAX = 30;
const HAN_ONLY = /^\p{Script=Han}+$/u;

export type EntryDraft = {
  readonly headword: string;
  readonly kind: LexiconKind;
  readonly reading: string;
  readonly gloss: string;
  readonly source: LexiconEntry["source"];
  readonly provenance: AiProvenance | null;
};

export type EntryFailure =
  | { readonly kind: "not-han" }
  | { readonly kind: "too-long"; readonly max: number }
  | InvalidReading;

/** Numbered pinyin, every part a syllable: `readingKey` alone lets other text through. */
const numbered = (reading: string): Result<string, InvalidReading> => {
  const tokens = parseNumbered(reading);
  return tokens.ok && tokens.value.every(({ kind }) => kind === "syllable")
    ? readingKey(reading)
    : err({ kind: "invalid-reading", reading });
};

/** The entry as it is stored: texts trimmed, the reading in the dictionary's form, empty ones null. */
export const checkEntry = ({
  headword,
  kind,
  reading,
  gloss,
  source,
  provenance,
}: EntryDraft): Result<NewEntry, EntryFailure> => {
  const word = headword.trim();
  if (!HAN_ONLY.test(word)) return err({ kind: "not-han" });
  if (Array.from(word).length > HEADWORD_MAX) return err({ kind: "too-long", max: HEADWORD_MAX });
  const spoken = reading.trim();
  const key = spoken === "" ? ok(null) : numbered(spoken);
  if (!key.ok) return key;
  const meaning = gloss.trim();
  return ok({
    headword: word,
    kind,
    reading: key.value,
    gloss: meaning === "" ? null : meaning,
    source,
    provenance,
  });
};

export type Lexicon = {
  /** Segmented as one word. */
  readonly headwords: ReadonlySet<string>;
  /** Validated proper names, known by definition (ADR 0014). */
  readonly names: readonly string[];
};

export const readLexicon = async (db: Database): Promise<Lexicon> => {
  const entries = await db.lexicon.toArray();
  return {
    headwords: new Set(entries.map(({ headword }) => headword)),
    names: entries.filter(({ kind }) => kind !== "word").map(({ headword }) => headword),
  };
};

export const loadLexicon = (db: Database): Promise<Result<Lexicon, ReviewLogFailure>> =>
  guarded(async () => ok(await readLexicon(db)));

/** Keeps the entry, dated; a headword already there is replaced. */
export const acceptEntry = (
  db: Database,
  entry: NewEntry,
  at: number = Date.now(),
): Promise<Result<null, ReviewLogFailure>> =>
  guarded(async () => {
    await db.lexicon.put({ ...entry, validatedAt: at });
    return ok(null);
  });

export const removeEntry = (
  db: Database,
  headword: string,
): Promise<Result<null, ReviewLogFailure>> =>
  guarded(async () => {
    await db.lexicon.delete(headword);
    return ok(null);
  });
