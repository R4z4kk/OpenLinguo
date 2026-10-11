import {
  err,
  replay,
  type CardState,
  type ReplayError,
  type Result,
  type Review,
} from "@openlinguo/core";
import type { Database } from "./database.ts";

export type ReviewLogFailure =
  | ReplayError
  | { readonly kind: "unknown-card"; readonly cardId: string }
  | { readonly kind: "storage"; readonly message: string };

/** The detail shown in an error message. */
export const describeFailure = (failure: ReviewLogFailure): string =>
  "message" in failure
    ? failure.message
    : `${failure.kind} ${"cardId" in failure ? failure.cardId : failure.reviewId}`;

export const guarded = async <T, E = ReviewLogFailure>(
  run: () => Promise<Result<T, E>>,
): Promise<Result<T, E | ReviewLogFailure>> => {
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
