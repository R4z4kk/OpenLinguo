import { learningDay, ok, type Result } from "@openlinguo/core";
import { currentCorrections } from "./correction.ts";
import type { Database, StoredJournalEntry } from "./database.ts";
import type { LocalTime } from "./decks.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

export type JournalEntry = Pick<StoredJournalEntry, "day" | "text" | "corrections">;

const segmenter = new Intl.Segmenter("zh", { granularity: "sentence" });

/** The sentences « Correct » sends, one correction each. */
export const journalSentences = (text: string): readonly string[] =>
  Array.from(segmenter.segment(text), ({ segment }) => segment.trim()).filter(
    (sentence) => sentence !== "",
  );

/** The learning day an entry written `now` belongs to. */
export const journalDay = (now: LocalTime): string => learningDay(now.at, now.utcOffsetMinutes);

/** The entry written on `day`, `null` when none was. */
export const loadJournalEntry = (
  db: Database,
  day: string,
): Promise<Result<JournalEntry | null, ReviewLogFailure>> =>
  guarded(async () => ok((await db.journal.get(day)) ?? null));

/** Every entry written before `day`, the latest first. */
export const listPastEntries = (
  db: Database,
  day: string,
): Promise<Result<readonly StoredJournalEntry[], ReviewLogFailure>> =>
  guarded(async () => ok(await db.journal.where("day").below(day).reverse().toArray()));

/**
 * Keeps the day's text with the corrections still about it. Nothing is written while the text is
 * empty and none was saved: `false`.
 */
export const saveJournalEntry = (
  db: Database,
  { day, text, corrections }: JournalEntry,
  at: number,
): Promise<Result<boolean, ReviewLogFailure>> =>
  guarded(async () => {
    if (text.trim() === "" && (await db.journal.get(day)) == null) return ok(false);
    await db.journal.put({
      day,
      text,
      corrections: currentCorrections(journalSentences(text), corrections),
      updatedAt: at,
    });
    return ok(true);
  });
