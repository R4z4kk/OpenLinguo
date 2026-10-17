import { z } from "zod";
import { CURRENT_SCHEDULER, fsrsNext, SCHEDULER_VERSIONS, type SchedulerFailure } from "./fsrs.ts";
import { LANGUAGE_IDS, type LanguageId } from "./language-pack.ts";
import { err, ok, type Result } from "./result.ts";

const MINUTE = 60_000;
const ROLLOVER = 4 * 60 * MINUTE;

/** Milliseconds since the Unix epoch (UTC), within the `Date` range. */
const Epoch = z.number().int().min(0).max(8_640_000_000_000_000);

export const CardType = z.enum(["recognition", "recall", "tone", "writing", "typing"]);
export type CardType = z.output<typeof CardType>;

/** The cards of a subject created together; a word's tone card comes once its reading has audio. */
export const PAIRED_TYPES = ["recognition", "recall"] as const satisfies readonly CardType[];
export type PairedType = (typeof PAIRED_TYPES)[number];

/** Cards a started word reading gets one at a time while it qualifies; notes get none. */
export const WORD_TYPES = ["tone", "writing", "typing"] as const satisfies readonly CardType[];
export type WordType = (typeof WORD_TYPES)[number];

export const isWordType = (type: CardType): type is WordType =>
  WORD_TYPES.some((wordType) => wordType === type);

export const Grade = z.enum(["again", "hard", "good", "easy"]);
export type Grade = z.output<typeof Grade>;

export const Phase = z.enum(["new", "learning", "review", "relearning"]);
export type Phase = z.output<typeof Phase>;

/** One reading of a word: its cards share it. */
export type WordKey = { readonly headword: string; readonly readingKey: string };

/** A note holding its own content; an imported note keeps its Anki guid. */
export type NoteKey = { readonly note: string };

/** What a card is about: its cards share it. */
export type Subject = WordKey | NoteKey;

export type CardKey = Subject & { readonly language: LanguageId; readonly type: CardType };

/** The subject's own fields, without the rest of the object it was read from. */
export const subjectOf = (subject: Subject): Subject =>
  "note" in subject
    ? { note: subject.note }
    : { headword: subject.headword, readingKey: subject.readingKey };

export const isWord = <T extends Subject>(subject: T): subject is Extract<T, WordKey> =>
  !("note" in subject);

/** Equal for the cards of one subject; a note's never equals a word's. */
export const subjectId = (subject: Subject): string =>
  JSON.stringify("note" in subject ? [subject.note] : [subject.headword, subject.readingKey]);

/**
 * Derived from the subject and type, so a card added on two devices is the same card. Note ids
 * have one part less than word ids.
 */
export const cardId = (key: CardKey): string =>
  JSON.stringify(
    "note" in key
      ? [key.language, key.note, key.type]
      : [key.language, key.headword, key.readingKey, key.type],
  );

const Language = z.enum(LANGUAGE_IDS);
const Part = z.string().min(1);
const CardFields = { id: z.string(), language: Language, type: CardType };

export const Card = z
  .union([
    z.object({ ...CardFields, headword: Part, readingKey: Part }),
    z.object({ ...CardFields, note: Part }),
  ])
  .refine((card) => card.id === cardId(card), {
    message: "id does not match the subject and type",
    path: ["id"],
  });
export type Card = z.output<typeof Card>;

/** The cards of one subject of the given types, created together. */
export const newCards = (
  language: LanguageId,
  subject: Subject,
  types: readonly CardType[] = PAIRED_TYPES,
): readonly Card[] =>
  types.map((type) => {
    const key = { ...subjectOf(subject), language, type };
    return { ...key, id: cardId(key) };
  });

const CardIdParts = z.union([
  z.tuple([Language, Part, Part, CardType]),
  z.tuple([Language, Part, CardType]),
]);

/** The key a card id derives from, `null` when the id is not one. */
export const cardKey = (id: string): CardKey | null => {
  let parts: unknown;
  try {
    parts = JSON.parse(id);
  } catch {
    return null;
  }
  const parsed = CardIdParts.safeParse(parts);
  if (!parsed.success) return null;
  if (parsed.data.length === 3) {
    const [language, note, type] = parsed.data;
    return { language, note, type };
  }
  const [language, headword, readingKey, type] = parsed.data;
  return { language, headword, readingKey, type };
};

/**
 * An append-only review log entry. `utcOffsetMinutes` is local time minus UTC (Paris summer: 120).
 * `dailyGoal` is the goal in effect when reviewing, so the streak derives from the log alone; the
 * review that empties the day's session caps it at the day's count, so a day with nothing left
 * to review is met.
 */
export const Review = z.object({
  id: z.uuid(),
  cardId: z.string().min(1),
  grade: Grade,
  reviewedAt: Epoch,
  utcOffsetMinutes: z
    .number()
    .int()
    .min(-12 * 60)
    .max(14 * 60),
  scheduler: z.enum(SCHEDULER_VERSIONS),
  dailyGoal: z.number().int().min(1),
});
export type Review = z.output<typeof Review>;

/** Cache of a card's replayed log. `due` is `null` until the first review. */
export const CardState = z.object({
  phase: Phase,
  due: Epoch.nullable(),
  stability: z.number().nonnegative(),
  difficulty: z.number().nonnegative(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  learningSteps: z.number().int().nonnegative(),
  scheduledDays: z.number().int().nonnegative(),
  firstReviewDay: z.iso.date().nullable(),
  lastReviewDay: z.iso.date().nullable(),
});
export type CardState = z.output<typeof CardState>;

export const NEW_CARD_STATE: CardState = {
  phase: "new",
  due: null,
  stability: 0,
  difficulty: 0,
  reps: 0,
  lapses: 0,
  learningSteps: 0,
  scheduledDays: 0,
  firstReviewDay: null,
  lastReviewDay: null,
};

/** Local time minus the 4:00 rollover: its UTC date is the learning day. */
const learningClock = (at: number, utcOffsetMinutes: number): number =>
  at + utcOffsetMinutes * MINUTE - ROLLOVER;

/** `YYYY-MM-DD`: the local date, with days starting at 4:00. */
export const learningDay = (at: number, utcOffsetMinutes: number): string =>
  new Date(learningClock(at, utcOffsetMinutes)).toISOString().slice(0, 10);

/** Whether a started card is due before the next rollover. */
export const dueToday = (due: number | null, at: number, utcOffsetMinutes: number): boolean =>
  due !== null && learningDay(due, utcOffsetMinutes) <= learningDay(at, utcOffsetMinutes);

/** What `applyReview` reads of a review, so a grade can be previewed without storing it. */
export type Grading = Pick<Review, "grade" | "reviewedAt" | "utcOffsetMinutes" | "scheduler">;

/** FSRS runs on the learning clock, so its elapsed days are learning days. */
export const applyReview = (
  state: CardState,
  review: Grading,
): Result<CardState & { readonly due: number }, SchedulerFailure> => {
  const lastReview = state.lastReviewDay === null ? null : Date.parse(state.lastReviewDay);
  const step = fsrsNext(
    review.scheduler,
    state,
    lastReview,
    learningClock(review.reviewedAt, review.utcOffsetMinutes),
    review.grade,
  );
  if (!step.ok) return step;
  const day = learningDay(review.reviewedAt, review.utcOffsetMinutes);
  return ok({
    ...step.value.memory,
    due: review.reviewedAt + step.value.interval,
    firstReviewDay: state.firstReviewDay ?? day,
    lastReviewDay: day,
  });
};

export type GradeOutcome = { readonly grade: Grade; readonly due: number };

/** The due time of each grade given now, in grade order, shown on the grade buttons. */
export const previewGrades = (
  state: CardState,
  at: number,
  utcOffsetMinutes: number,
): Result<readonly GradeOutcome[], SchedulerFailure> => {
  const outcomes: GradeOutcome[] = [];
  for (const grade of Grade.options) {
    const next = applyReview(state, {
      grade,
      reviewedAt: at,
      utcOffsetMinutes,
      scheduler: CURRENT_SCHEDULER,
    });
    if (!next.ok) return next;
    outcomes.push({ grade, due: next.value.due });
  }
  return ok(outcomes);
};

export type ReplayError =
  | SchedulerFailure
  | { readonly kind: "foreign-review"; readonly reviewId: string }
  | { readonly kind: "duplicate-review"; readonly reviewId: string };

export const chronological = (a: Review, b: Review): number =>
  a.reviewedAt - b.reviewedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A card's state from its whole log, in any order: the source of truth for the cache. */
export const replay = (
  cardId: string,
  reviews: readonly Review[],
): Result<CardState, ReplayError> => {
  const seen = new Set<string>();
  let state = NEW_CARD_STATE;
  for (const review of [...reviews].sort(chronological)) {
    if (review.cardId !== cardId) return err({ kind: "foreign-review", reviewId: review.id });
    if (seen.has(review.id)) return err({ kind: "duplicate-review", reviewId: review.id });
    seen.add(review.id);
    const next = applyReview(state, review);
    if (!next.ok) return next;
    state = next.value;
  }
  return ok(state);
};
