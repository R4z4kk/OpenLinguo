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

export const DECISION_SOURCES = ["own-initiative", "notice"] as const;

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
  /** DSA art. 17(3)(b): whether the decision follows a notice. */
  source: z.enum(DECISION_SOURCES),
  automated: z.literal(false),
  decidedAt: z.iso.datetime(),
});
export type StatementOfReasons = z.output<typeof StatementOfReasons>;

/**
 * What a notice claims (DSA art. 16(2)(a)): the checklist's illegal categories, child sexual abuse
 * material on its own since it needs no name or email (16(2)(c)), and the library rules.
 */
export const NOTICE_REASONS = [
  "copyright",
  "defamation",
  "hate",
  "personal-data",
  "child-sexual-abuse",
  "serious-offences",
  "library-rules",
] as const;
export const NoticeReason = z.enum(NOTICE_REASONS);
export type NoticeReason = z.output<typeof NoticeReason>;

export const NOTIFIER_NAME_MAX = 100;
export const EMAIL_MAX = 254;

const notifier = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(NOTIFIER_NAME_MAX)
    .refine((value) => !/[\p{Cc}]/u.test(value), "Plain text only")
    .nullable(),
  email: z.email().max(EMAIL_MAX).nullable(),
};

/** `POST /api/notices`, with no account (DSA art. 16(2), #267 mockups). */
export const NewNotice = z
  .object({
    submissionId: z.string().min(1),
    reason: NoticeReason,
    /** 16(2)(a): why the notifier holds the text illegal or against the rules. */
    explanation: prose,
    ...notifier,
    /** 16(2)(d). */
    goodFaith: z.literal(true),
  })
  .superRefine(({ reason, name, email }, context) => {
    if (reason === "child-sexual-abuse") return;
    if (name === null) context.addIssue({ code: "custom", path: ["name"], message: "Required" });
    if (email === null) context.addIssue({ code: "custom", path: ["email"], message: "Required" });
  });
export type NewNotice = z.output<typeof NewNotice>;

/** Whether the receipt of 16(4) left: `none` when the notice gave no email. */
export const NoticeReceipt = z.object({
  id: z.string().min(1),
  createdAt: z.iso.datetime(),
  receipt: z.enum(["sent", "failed", "none"]),
});
export type NoticeReceipt = z.output<typeof NoticeReceipt>;

export const NOTICE_OUTCOMES = ["kept", "removed"] as const;

/** 16(5): the decision, as the notifier is told it. */
export const NoticeDecision = z.object({
  outcome: z.enum(NOTICE_OUTCOMES),
  reply: prose,
  decidedAt: z.iso.datetime(),
});
export type NoticeDecision = z.output<typeof NoticeDecision>;

/** A notice as the admin reads it; the submitter never sees the notifier. */
export const Notice = z.object({
  id: z.string().min(1),
  submissionId: z.string().min(1),
  title: z.string().min(1),
  reason: NoticeReason,
  explanation: z.string().min(1),
  name: z.string().min(1).nullable(),
  email: z.string().min(1).nullable(),
  createdAt: z.iso.datetime(),
  decision: NoticeDecision.nullable(),
});
export type Notice = z.output<typeof Notice>;
export const Notices = z.array(Notice);

/** `POST /api/admin/notices/:id/keep`. */
export const KeepNotice = z.object({ reply: prose });
export type KeepNotice = z.output<typeof KeepNotice>;

/** The notifiers whose decision mail failed, for the admin to write to by hand. */
export const NoticeDecided = z.object({
  unsent: z.array(z.string().min(1)),
  statement: StatementOfReasons.nullable(),
});
export type NoticeDecided = z.output<typeof NoticeDecided>;

/** 1-based rank in HSK 2025, the last one being 7-9. */
export const BANDS = proficiencyFrameworks["hsk-2025"].length;
export const Band = z.number().int().min(1).max(BANDS);

/** The HSK 2025 name of a band: 1 to 6, then 7-9. */
export const bandName = (band: number): string =>
  proficiencyFrameworks["hsk-2025"][band - 1] ?? String(band);

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
