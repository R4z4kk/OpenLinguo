import { ok, type Result } from "@openlinguo/core";
import { z } from "zod";
import type { Database } from "./database.ts";
import { Found } from "./lexicon.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

/** Sources that cost a request: their answers are kept so that a sequence is never sent twice. */
export const RESOLUTION_SOURCES = ["wikidata", "ai"] as const;

/** What a source answered for a sequence, found or not, and when. */
export const Resolution = z.object({
  sequence: z.string().min(1),
  source: z.enum(RESOLUTION_SOURCES),
  /** Empty: the source was asked and found nothing. */
  found: z.array(Found),
  checkedAt: z.number().int().nonnegative(),
});
export type Resolution = z.output<typeof Resolution>;

/** The kept answers for these sequences. */
export const loadResolutions = (
  db: Database,
  sequences: readonly string[],
): Promise<Result<readonly Resolution[], ReviewLogFailure>> =>
  guarded(async () => ok(await db.resolutions.where("sequence").anyOf(sequences).toArray()));

/** Keeps an answer, replacing the one of the same sequence and source: a new check is one click away. */
export const saveResolution = (
  db: Database,
  resolution: Resolution,
): Promise<Result<null, ReviewLogFailure>> =>
  guarded(async () => {
    await db.resolutions.put(resolution);
    return ok(null);
  });
