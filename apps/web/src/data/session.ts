import {
  applyReview,
  composeSession,
  CURRENT_SCHEDULER,
  dueToday,
  NEW_CARD_STATE,
  ok,
  type CardState,
  type DictEntry,
  type Grade,
  type Grading,
  type ProgressError,
  type Result,
  type SessionItem,
} from "@openlinguo/core";
import type { ZhProficiency } from "@openlinguo/lang-zh";
import { todayActivity } from "./daily-goal.ts";
import type { Database } from "./database.ts";
import { entryId, introduceWord, nextNewReadings, type LocalTime } from "./decks.ts";
import { toDictEntry } from "./dictionary.ts";
import { guarded, recordReview, type ReviewLogFailure } from "./review-log.ts";

/** `audio`: the id of audio a deck gives the reading. */
export type ReviewItem = SessionItem & {
  readonly entry: DictEntry;
  readonly state: CardState;
  readonly audio: string | null;
};

/** `skipped`: cards whose reading left the dictionary. */
export type Session = { readonly items: readonly ReviewItem[]; readonly skipped: number };

export const loadSession = (
  db: Database,
  referential: ZhProficiency,
  now: LocalTime,
  newLimit: number,
): Promise<Result<Session, ReviewLogFailure>> =>
  guarded(async () => {
    const newReadings = await nextNewReadings(db, referential, newLimit);
    if (!newReadings.ok) return newReadings;
    const cards = await db.cards.toArray();
    const items = composeSession({
      language: "zh",
      cards,
      newReadings: newReadings.value,
      newLimit,
      at: now.at,
      utcOffsetMinutes: now.utcOffsetMinutes,
    });
    const states = new Map(cards.map((card) => [card.id, card]));
    const entries = await db.entries.bulkGet(items.map(entryId));
    const filed = (
      await Promise.all(
        items.map((item) =>
          db.deckWords
            .where("[headword+readingKey]")
            .equals([item.headword, item.readingKey])
            .toArray(),
        ),
      )
    ).flat();
    const voiced = new Set(
      (
        await Promise.all(filed.map((word) => db.audio.where(":id").equals(word.id).primaryKeys()))
      ).flat(),
    );
    const audioOf = new Map(
      filed.filter((word) => voiced.has(word.id)).map((word) => [entryId(word), word.id] as const),
    );
    const joined = items.flatMap((item, index) => {
      const row = entries[index];
      return row == null
        ? []
        : [
            {
              ...item,
              entry: toDictEntry(row, referential),
              state: states.get(item.cardId) ?? NEW_CARD_STATE,
              audio: audioOf.get(entryId(item)) ?? null,
            },
          ];
    });
    return ok({ items: joined, skipped: items.length - joined.length });
  });

const comesBack = (state: CardState, now: LocalTime): boolean =>
  state.phase !== "review" && dueToday(state.due, now.at, now.utcOffsetMinutes);

/** The goal in effect, capped at the day's count by the grade that empties the session. */
const goalToStamp = async (
  db: Database,
  item: ReviewItem,
  grading: Grading,
  now: LocalTime,
  dailyGoal: number,
  last: boolean,
): Promise<Result<number, ReviewLogFailure | ProgressError>> => {
  if (!last) return ok(dailyGoal);
  const next = applyReview(item.state, grading);
  if (!next.ok) return next;
  if (comesBack(next.value, now)) return ok(dailyGoal);
  const today = await todayActivity(db, now);
  if (!today.ok) return today;
  return ok(Math.min(dailyGoal, today.value.reviews + 1));
};

/**
 * Records a grade, storing the cards of a band word first; the item comes back if still due today.
 * `last`: no other item is left in the session.
 */
export const gradeItem = async (
  db: Database,
  item: ReviewItem,
  grade: Grade,
  now: LocalTime,
  dailyGoal: number,
  last: boolean,
): Promise<Result<ReviewItem | null, ReviewLogFailure | ProgressError>> => {
  const grading = {
    grade,
    reviewedAt: now.at,
    utcOffsetMinutes: now.utcOffsetMinutes,
    scheduler: CURRENT_SCHEDULER,
  };
  const goal = await goalToStamp(db, item, grading, now, dailyGoal, last);
  if (!goal.ok) return goal;
  if (item.new) {
    const stored = await introduceWord(db, item);
    if (!stored.ok) return stored;
  }
  const state = await recordReview(db, {
    ...grading,
    id: crypto.randomUUID(),
    cardId: item.cardId,
    dailyGoal: goal.value,
  });
  if (!state.ok) return state;
  return ok(comesBack(state.value, now) ? { ...item, new: false, state: state.value } : null);
};
