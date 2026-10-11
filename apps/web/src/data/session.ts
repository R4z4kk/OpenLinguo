import {
  composeSession,
  CURRENT_SCHEDULER,
  dueToday,
  NEW_CARD_STATE,
  ok,
  type CardState,
  type DictEntry,
  type Grade,
  type Result,
  type SessionItem,
} from "@openlinguo/core";
import type { ZhProficiency } from "@openlinguo/lang-zh";
import type { Database } from "./database.ts";
import { entryId, introduceWord, nextNewReadings, type LocalTime } from "./decks.ts";
import { toDictEntry } from "./dictionary.ts";
import { guarded, recordReview, type ReviewLogFailure } from "./review-log.ts";

/** Anki's default `new_per_day` (ankitects/anki rslib/src/deckconfig/mod.rs); a setting in #79. */
export const DEFAULT_NEW_CARDS_PER_DAY = 20;

export type ReviewItem = SessionItem & { readonly entry: DictEntry; readonly state: CardState };

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
    const joined = items.flatMap((item, index) => {
      const row = entries[index];
      return row == null
        ? []
        : [
            {
              ...item,
              entry: toDictEntry(row, referential),
              state: states.get(item.cardId) ?? NEW_CARD_STATE,
            },
          ];
    });
    return ok({ items: joined, skipped: items.length - joined.length });
  });

/** Records a grade, storing the cards of a band word first; the item comes back if still due today. */
export const gradeItem = async (
  db: Database,
  item: ReviewItem,
  grade: Grade,
  now: LocalTime,
): Promise<Result<ReviewItem | null, ReviewLogFailure>> => {
  if (item.new) {
    const stored = await introduceWord(db, item);
    if (!stored.ok) return stored;
  }
  const state = await recordReview(db, {
    id: crypto.randomUUID(),
    cardId: item.cardId,
    grade,
    reviewedAt: now.at,
    utcOffsetMinutes: now.utcOffsetMinutes,
    scheduler: CURRENT_SCHEDULER,
  });
  if (!state.ok) return state;
  return ok(
    state.value.phase !== "review" && dueToday(state.value.due, now.at, now.utcOffsetMinutes)
      ? { ...item, new: false, state: state.value }
      : null,
  );
};
