import type { LanguageId } from "./language-pack.ts";
import {
  cardId,
  dueToday,
  learningDay,
  subjectId,
  subjectOf,
  type Card,
  type CardState,
  type CardType,
  type Subject,
  type WordKey,
} from "./srs.ts";

/** What the composer reads of a stored card. */
export type SessionCard = Subject &
  Pick<Card, "id" | "type"> &
  Pick<CardState, "phase" | "due" | "firstReviewDay" | "lastReviewDay">;

export type SessionItem = Subject & {
  readonly cardId: string;
  readonly type: CardType;
  /** Never reviewed; the cards of a band word are not stored yet. */
  readonly new: boolean;
};

export type SessionInput = {
  readonly language: LanguageId;
  readonly cards: readonly SessionCard[];
  /** Readings and notes without a started card, in new-card order (personal, level, frequency). */
  readonly newReadings: readonly Subject[];
  /**
   * Readings with a recording installed and a tone to hear: only they have a tone card, stored or
   * new. One without a stored tone card gets one once its first card is started.
   */
  readonly toneWords: readonly WordKey[];
  /** New cards per learning day, those already started today included. */
  readonly newLimit: number;
  readonly at: number;
  readonly utcOffsetMinutes: number;
};

const byId = (a: { readonly id: string }, b: { readonly id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Today's session: due cards, most overdue first, then new cards up to the daily limit: the
 * other cards of a started subject (recall, tone), then new subjects, recognition first. A subject
 * shows one card per learning day. A tone card is only offered while its reading has audio.
 */
export const composeSession = (input: SessionInput): readonly SessionItem[] => {
  const today = learningDay(input.at, input.utcOffsetMinutes);
  const toned = new Set(input.toneWords.map(subjectId));
  const cards = input.cards.filter((card) => card.type !== "tone" || toned.has(subjectId(card)));
  const reviewedToday = new Map(
    cards.filter((card) => card.lastReviewDay === today).map((card) => [subjectId(card), card.id]),
  );
  const taken = new Set<string>();
  const items: SessionItem[] = [];
  const take = (
    card: Subject & { readonly id: string; readonly type: CardType },
    isNew: boolean,
  ) => {
    const subject = subjectId(card);
    const sibling = reviewedToday.get(subject);
    if (taken.has(subject) || (sibling != null && sibling !== card.id)) return false;
    taken.add(subject);
    items.push({ ...subjectOf(card), cardId: card.id, type: card.type, new: isNew });
    return true;
  };

  const started = cards.filter((card) => card.phase !== "new");
  for (const card of started
    .filter((card) => dueToday(card.due, input.at, input.utcOffsetMinutes))
    .sort((a, b) => (a.due ?? 0) - (b.due ?? 0) || byId(a, b))) {
    take(card, false);
  }

  let budget = input.newLimit - cards.filter((card) => card.firstReviewDay === today).length;
  const startedOn = new Map<string, string>();
  for (const card of started) {
    const day = startedOn.get(subjectId(card));
    if (card.firstReviewDay !== null && (day == null || card.firstReviewDay < day))
      startedOn.set(subjectId(card), card.firstReviewDay);
  }
  const hasTone = new Set(cards.filter((card) => card.type === "tone").map(subjectId));
  const missingTones = input.toneWords
    .filter((word) => startedOn.has(subjectId(word)) && !hasTone.has(subjectId(word)))
    .map((word) => {
      const key = { ...subjectOf(word), language: input.language, type: "tone" } as const;
      return { card: { ...key, id: cardId(key) }, day: startedOn.get(subjectId(word)) ?? today };
    });
  const waiting = [
    ...cards
      .filter((card) => card.phase === "new" && startedOn.has(subjectId(card)))
      .map((card) => ({ card, day: startedOn.get(subjectId(card)) ?? today })),
    ...missingTones,
  ].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : byId(a.card, b.card)));
  for (const { card } of waiting) {
    if (budget <= 0) break;
    if (take(card, true)) budget -= 1;
  }
  for (const subject of input.newReadings) {
    if (budget <= 0) break;
    const key = { ...subjectOf(subject), language: input.language, type: "recognition" } as const;
    if (take({ ...key, id: cardId(key) }, true)) budget -= 1;
  }
  return items;
};
