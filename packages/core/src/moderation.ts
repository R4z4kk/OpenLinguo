import { z } from "zod";
import { proficiencyFrameworks, type AnnotatedToken } from "./language-pack.ts";

/** The admin ticks all six before approving a text (#267 mockups). */
export const MODERATION_CHECKS = [
  "copyright",
  "defamation",
  "hate",
  "personal-data",
  "serious-offences",
  "library-rules",
] as const;
export type ModerationCheck = (typeof MODERATION_CHECKS)[number];

/** Read on Légifrance on 2026-10-31; LCEN art. 6 in its version of 2026-08-26 (loi 2026-813). */
export const LEGAL_GROUNDS = {
  copyright: "Code de la propriété intellectuelle, art. L122-4",
  defamation: "Loi du 29 juillet 1881, art. 29 et 32",
  hate: "Loi du 29 juillet 1881, art. 24, 32 et 33",
  "personal-data": "Code civil, art. 9 ; RGPD, art. 6",
  "serious-offences": "LCEN (loi 2004-575), art. 6, IV, A",
} as const;

/** The rules of `/terms` a statement cites by number (#267 mockups, #279). */
export const TERMS_CLAUSES = {
  "not-chinese": "3.2",
  "duplicate-or-spam": "3.3",
  "unsuitable-for-teenagers": "3.4",
} as const;

export const GROUNDS = [
  "copyright",
  "defamation",
  "hate",
  "personal-data",
  "serious-offences",
  "not-chinese",
  "duplicate-or-spam",
  "unsuitable-for-teenagers",
] as const;
export const Ground = z.enum(GROUNDS);
export type Ground = z.output<typeof Ground>;

export const isLegalGround = (ground: Ground): ground is keyof typeof LEGAL_GROUNDS =>
  ground in LEGAL_GROUNDS;

export const isTermsGround = (ground: Ground): ground is keyof typeof TERMS_CLAUSES =>
  ground in TERMS_CLAUSES;

export const RESTRICTIONS = ["rejected", "removed"] as const;
export const Restriction = z.enum(RESTRICTIONS);
export type Restriction = z.output<typeof Restriction>;

export const STATEMENT_MAX = 2_000;

const prose = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => Array.from(value).length <= STATEMENT_MAX,
    `At most ${String(STATEMENT_MAX)} characters`,
  );

/** The admin's part of a statement of reasons; the measure follows from the route. */
export const NewStatementOfReasons = z.object({
  ground: Ground,
  /** DSA art. 17(3)(b). */
  facts: prose,
  /** DSA art. 17(3)(d) or (e): why the text is illegal or against the rules. */
  explanation: prose,
});
export type NewStatementOfReasons = z.output<typeof NewStatementOfReasons>;

/** DSA art. 17(3), stored in `decision` and mailed to the submitter. */
export const StatementOfReasons = NewStatementOfReasons.extend({
  id: z.string().min(1),
  submissionId: z.string().min(1),
  measure: Restriction,
  /** Notices arrive with #276. */
  source: z.literal("own-initiative"),
  automated: z.literal(false),
  decidedAt: z.iso.datetime(),
});
export type StatementOfReasons = z.output<typeof StatementOfReasons>;

/** 1-based rank in HSK 2025, the last one being 7-9. */
export const BANDS = proficiencyFrameworks["hsk-2025"].length;
export const Band = z.number().int().min(1).max(BANDS);

export const Approval = z.object({ band: Band });
export type Approval = z.output<typeof Approval>;

/** The reader's target (ADR 0014): words up to the band cover at least 98 % of the text. */
export const BAND_COVERAGE_PERCENT = 98;

export type BandEstimate = {
  readonly band: number;
  /** Han word tokens per HSK 2025 level, index 0 for level 1. */
  readonly byLevel: readonly number[];
  /** Tokens of dictionary words outside HSK 2025. */
  readonly outside: number;
  readonly total: number;
};

const HAN = /\p{Script=Han}/u;

/**
 * Per running Han word token the dictionary has; words it lacks, names mostly, are left out. The
 * band is the lowest level whose words reach the target, else the last; `null` without such words.
 * `levelOf` gives a word's lowest HSK 2025 level, `null` outside it.
 */
export const estimateBand = (
  tokens: readonly AnnotatedToken[],
  levelOf: ReadonlyMap<string, number | null>,
): BandEstimate | null => {
  const byLevel = Array.from({ length: BANDS }, () => 0);
  let outside = 0;
  let total = 0;
  for (const token of tokens) {
    if (!token.isWord || token.readings.length === 0 || !HAN.test(token.text)) continue;
    total += 1;
    const level = levelOf.get(token.text) ?? null;
    if (level === null || level < 1 || level > BANDS) outside += 1;
    else byLevel[level - 1] = (byLevel[level - 1] ?? 0) + 1;
  }
  if (total === 0) return null;
  let covered = 0;
  let band = BANDS;
  for (const [index, count] of byLevel.entries()) {
    covered += count;
    if (100 * covered >= BAND_COVERAGE_PERCENT * total) {
      band = index + 1;
      break;
    }
  }
  return { band, byLevel, outside, total };
};
