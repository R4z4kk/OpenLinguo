import { err, ok, type ReadingChoices, type Result, type WordKey } from "@openlinguo/core";
import type { Database } from "./database.ts";
import { describeFailure, guarded, type ReviewLogFailure } from "./review-log.ts";

export type WordSheetFailure =
  ReviewLogFailure | { readonly kind: "unknown-text"; readonly textId: string };

export const describeSheetFailure = (failure: WordSheetFailure): string =>
  failure.kind === "unknown-text" ? `${failure.kind} ${failure.textId}` : describeFailure(failure);

/** Fixes the reading of one occurrence in a text; returns the choices of the text. */
export const chooseReading = (
  db: Database,
  textId: string,
  start: number,
  reading: string,
): Promise<Result<ReadingChoices, WordSheetFailure>> =>
  guarded(() =>
    db.transaction("rw", db.texts, async (): Promise<Result<ReadingChoices, WordSheetFailure>> => {
      const text = await db.texts.get(textId);
      if (text == null) return err({ kind: "unknown-text", textId });
      const readingChoices = { ...text.readingChoices, [start]: reading };
      await db.texts.put({ ...text, readingChoices });
      return ok(readingChoices);
    }),
  );

/** « Je connais » for a reading, or « Je ne connais plus ». */
export const setKnownMark = (
  db: Database,
  { headword, readingKey }: WordKey,
  known: boolean,
  at: number,
): Promise<Result<null, ReviewLogFailure>> =>
  guarded(async () => {
    if (known) await db.knownMarks.put({ headword, readingKey, markedAt: at });
    else await db.knownMarks.delete([headword, readingKey]);
    return ok(null);
  });

export const isMarked = (
  db: Database,
  { headword, readingKey }: WordKey,
): Promise<Result<boolean, ReviewLogFailure>> =>
  guarded(async () => ok((await db.knownMarks.get([headword, readingKey])) != null));
