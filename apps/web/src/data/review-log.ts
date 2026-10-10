import {
  err,
  ok,
  replay,
  type CardState,
  type ReplayError,
  type Result,
  type Review,
} from "@openlinguo/core";
import type { Database, StoredCard } from "./database.ts";

export type ReviewLogFailure =
  | ReplayError
  | { readonly kind: "unknown-card"; readonly cardId: string }
  | { readonly kind: "storage"; readonly message: string };

const guarded = async <T>(
  run: () => Promise<Result<T, ReviewLogFailure>>,
): Promise<Result<T, ReviewLogFailure>> => {
  try {
    return await run();
  } catch (error) {
    return err({ kind: "storage", message: String(error) });
  }
};

/** Appends a review and replays its card's whole log, so a late review lands in order. */
export const recordReview = (
  db: Database,
  review: Review,
): Promise<Result<CardState, ReviewLogFailure>> =>
  guarded(() =>
    db.transaction(
      "rw",
      [db.cards, db.reviews],
      async (): Promise<Result<CardState, ReviewLogFailure>> => {
        const card = await db.cards.get(review.cardId);
        if (card == null) return err({ kind: "unknown-card", cardId: review.cardId });
        const log = await db.reviews.where("cardId").equals(review.cardId).toArray();
        const state = replay(card.id, [...log, review]);
        if (!state.ok) return state;
        await db.reviews.add(review);
        await db.cards.put({ ...card, ...state.value });
        return state;
      },
    ),
  );

/** Replays every card from the log, e.g. after an import. Reviews of removed cards stay. */
export const rebuildCards = (db: Database): Promise<Result<null, ReviewLogFailure>> =>
  guarded(() =>
    db.transaction(
      "rw",
      [db.cards, db.reviews],
      async (): Promise<Result<null, ReviewLogFailure>> => {
        const logs = Map.groupBy(await db.reviews.toArray(), (review) => review.cardId);
        const cards: StoredCard[] = [];
        for (const card of await db.cards.toArray()) {
          const state = replay(card.id, logs.get(card.id) ?? []);
          if (!state.ok) return state;
          cards.push({ ...card, ...state.value });
        }
        await db.cards.bulkPut(cards);
        return ok(null);
      },
    ),
  );
