import type { LanguageId } from "./language-pack.ts";
import {
  cardId,
  dueToday,
  isWordType,
  learningDay,
  subjectId,
  subjectOf,
  WORD_TYPES,
  type Card,
  type CardState,
  type CardType,
  type Subject,
  type WordKey,
  type WordType,
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
  /**
   * Likewise for writing cards: readings whose characters all have stroke data, while handwriting
   * practice is on.
   */
  readonly writingWords: readonly WordKey[];
  /** Likewise for typing cards: readings, while typing practice is on and the pack has an IME. */
  readonly typingWords: readonly WordKey[];
  /** New cards per learning day, those already started today included. */
  readonly newLimit: number;
  readonly at: number;
  readonly utcOffsetMinutes: number;
};

const byId = (a: { readonly id: string }, b: { readonly id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Today's session: due cards, most overdue first, then new cards up to the daily limit: the
 * other cards of a started subject (recall, tone, writing, typing), then new subjects, recognition
 * first. A subject shows one card per learning day. A tone, writing or typing card is only offered
 * while its reading is in the matching list.
 */
export const composeSession = (input: SessionInput): readonly SessionItem[] => {
  const today = learningDay(input.at, input.utcOffsetMinutes);
  const wordsOf: Record<WordType, readonly WordKey[]> = {
    tone: input.toneWords,
    writing: input.writingWords,
    typing: input.typingWords,
  };
  const offered = WORD_TYPES.flatMap((type) =>
    wordsOf[type].map((word) => {
      const key = { ...subjectOf(word), language: input.language, type };
      return { ...key, id: cardId(key) };
    }),
  );
  const offeredIds = new Set(offered.map((card) => card.id));
  const cards = input.cards.filter((card) => !isWordType(card.type) || offeredIds.has(card.id));
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
  const stored = new Set(input.cards.map((card) => card.id));
  const waiting = [
    ...cards.filter((card) => card.phase === "new"),
    ...offered.filter((card) => !stored.has(card.id)),
  ]
    .filter((card) => startedOn.has(subjectId(card)))
    .map((card) => ({ card, day: startedOn.get(subjectId(card)) ?? today }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : byId(a.card, b.card)));
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
