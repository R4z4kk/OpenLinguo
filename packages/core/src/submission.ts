import { z } from "zod";
import { AiProvenance } from "./ai-provenance.ts";

/** Confirmed by the reader benchmark on 2026-10-22 (ADR 0014, update). */
export const MAX_TEXT_CHARACTERS = 20_000;
export const TITLE_MAX = 100;
export const PSEUDONYM_MAX = 40;
export const MAX_PENDING_SUBMISSIONS = 5;
export const ATTESTATION_VERSION = 1;

export const characterCount = (text: string): number => Array.from(text).length;

/** Fixed by the origin (ADR 0015): a learner's own text or a story generated in the app. */
export const LICENCES = { human: "CC-BY-SA-4.0", ai: "CC0-1.0" } as const;
export const Licence = z.enum([LICENCES.human, LICENCES.ai]);
export type Licence = z.output<typeof Licence>;

export const SUBMISSION_STATUSES = ["pending", "approved", "rejected", "removed"] as const;
export const SubmissionStatus = z.enum(SUBMISSION_STATUSES);
export type SubmissionStatus = z.output<typeof SubmissionStatus>;

// Control characters other than tab, line feed and carriage return.
const CONTROL = /[^\P{Cc}\t\n\r]/u;

const plain = (max: number, singleLine: boolean) =>
  z
    .string()
    .trim()
    .min(1)
    .refine((value) => characterCount(value) <= max, `At most ${String(max)} characters`)
    .refine(
      (value) => !CONTROL.test(value) && !(singleLine && /[\r\n]/u.test(value)),
      "Plain text only",
    );

export const Pseudonym = plain(PSEUDONYM_MAX, true);

export const Attribution = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("anonymous") }),
  z.object({ kind: z.literal("pseudonym"), name: Pseudonym }),
]);
export type Attribution = z.output<typeof Attribution>;

const human = { origin: z.literal("human"), provenance: z.null() };
const ai = { origin: z.literal("ai"), provenance: AiProvenance };

const draft = {
  title: plain(TITLE_MAX, true),
  body: plain(MAX_TEXT_CHARACTERS, false),
  attribution: Attribution,
  /** Sent only once every statement of this attestation version is ticked. */
  attestationVersion: z.literal(ATTESTATION_VERSION),
};

/** `POST /api/submissions`: the licence and the attestation time are the server's. */
export const NewSubmission = z.discriminatedUnion("origin", [
  z.object({ ...draft, ...human }),
  z.object({ ...draft, ...ai }),
]);
export type NewSubmission = z.output<typeof NewSubmission>;

const shared = {
  id: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  /** The pseudonym at the time of submission, `null` for anonymous. */
  attribution: z.string().min(1).nullable(),
};
const humanLicensed = { ...human, licence: z.literal(LICENCES.human) };
const aiLicensed = { ...ai, licence: z.literal(LICENCES.ai) };

const submitted = {
  ...shared,
  status: SubmissionStatus,
  attestationVersion: z.number().int().positive(),
  attestedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
};

/** A text as its submitter sees it in « Mes textes envoyés ». */
export const Submission = z.discriminatedUnion("origin", [
  z.object({ ...submitted, ...humanLicensed }),
  z.object({ ...submitted, ...aiLicensed }),
]);
export type Submission = z.output<typeof Submission>;

export const Submissions = z.array(Submission);

const published = { ...shared, publishedAt: z.iso.datetime() };

/** An approved text in the public library. */
export const LibraryItem = z.discriminatedUnion("origin", [
  z.object({ ...published, ...humanLicensed }),
  z.object({ ...published, ...aiLicensed }),
]);
export type LibraryItem = z.output<typeof LibraryItem>;
