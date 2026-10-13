import { z } from "zod";
import type { AsrId } from "./asr.ts";

/** The maintainer's verdict on a file: it says exactly the item, or a word is added, missing or wrong. */
export const labelsSchema = z.record(z.string(), z.enum(["clean", "wrong"]));
export type Labels = z.infer<typeof labelsSchema>;

/** Per file, whether each speech recognizer heard the item as written (see transcriptMatches). */
export type Verdicts = ReadonlyMap<string, Readonly<Partial<Record<AsrId, boolean>>>>;

/**
 * Files the recognizers disagree on: only these tell them apart, so the maintainer labels these. Files all of
 * them pass or all of them flag are left unlabelled and score for none.
 */
export const filesToLabel = (verdicts: Verdicts): string[] =>
  [...verdicts].filter(([, byAsr]) => new Set(Object.values(byAsr)).size > 1).map(([file]) => file);

export type AsrScore = {
  readonly flagged: number;
  readonly caught: number;
  readonly missed: number;
  readonly falseAlarms: number;
};

export const scoreAsr = (asr: AsrId, verdicts: Verdicts, labels: Labels): AsrScore => {
  let flagged = 0;
  let caught = 0;
  let missed = 0;
  let falseAlarms = 0;
  for (const [file, byAsr] of verdicts) {
    const flags = byAsr[asr] === false;
    const wrong = labels[file] === "wrong";
    if (flags) flagged++;
    if (flags && wrong) caught++;
    if (!flags && wrong) missed++;
    if (flags && labels[file] === "clean") falseAlarms++;
  }
  return { flagged, caught, missed, falseAlarms };
};
