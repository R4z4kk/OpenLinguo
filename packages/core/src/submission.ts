import { z } from "zod";
import { AiProvenance } from "./ai-provenance.ts";
import { Band } from "./moderation.ts";

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

const listed = {
  id: z.string().min(1),
  title: z.string().min(1),
  /** The pseudonym at the time of submission, `null` for anonymous. */
  attribution: z.string().min(1).nullable(),
};
const shared = { ...listed, body: z.string().min(1) };
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

/** The band is the admin's estimate at approval (ADR 0015). */
const card = { ...listed, band: Band, publishedAt: z.iso.datetime() };
const published = { ...card, body: z.string().min(1) };

/** An approved text as the global library lists it, without its body. */
export const LibrarySummary = z.discriminatedUnion("origin", [
  z.object({ ...card, ...humanLicensed }),
  z.object({ ...card, ...aiLicensed }),
]);
export type LibrarySummary = z.output<typeof LibrarySummary>;

/** An approved text in the public library. */
export const LibraryItem = z.discriminatedUnion("origin", [
  z.object({ ...published, ...humanLicensed }),
  z.object({ ...published, ...aiLicensed }),
]);
export type LibraryItem = z.output<typeof LibraryItem>;

export const LIBRARY_PAGE_SIZE = 20;

/** `GET /api/library`: one page, the latest published first. */
export const LibraryPage = z.object({
  items: z.array(LibrarySummary).max(LIBRARY_PAGE_SIZE),
  nextPage: z.number().int().min(2).nullable(),
});
export type LibraryPage = z.output<typeof LibraryPage>;

const Counting = z
  .string()
  .regex(/^[1-9]\d{0,5}$/u)
  .transform(Number);

/** `GET /api/library` query: each parameter absent or a positive integer. */
export const LibraryQuery = z.object({
  band: Counting.pipe(Band).nullable(),
  page: Counting.nullable(),
});
export type LibraryQuery = z.output<typeof LibraryQuery>;
