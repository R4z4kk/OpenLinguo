import { err, ok, type Result } from "./result.ts";
import type { Grade } from "./srs.ts";

export type ToneGrading = {
  readonly grade: Grade;
  /** One per syllable, in order. */
  readonly correct: readonly boolean[];
};

export type ToneAnswerError =
  { readonly kind: "no-syllable" } | { readonly kind: "length-mismatch" };

/**
 * Grades a tone card from the tones picked, 1–4 and 5 for neutral. A syllable is right when the pick
 * is its citation tone or the tone spoken after sandhi: the recording says the spoken one. Every
 * syllable right is good, at least half hard, otherwise again; never easy, as nothing tells how
 * hard it was.
 */
export const gradeTones = (
  citation: readonly number[],
  spoken: readonly number[],
  picks: readonly number[],
): Result<ToneGrading, ToneAnswerError> => {
  if (citation.length === 0) return err({ kind: "no-syllable" });
  if (spoken.length !== citation.length || picks.length !== citation.length)
    return err({ kind: "length-mismatch" });
  const correct = picks.map((pick, index) => pick === citation[index] || pick === spoken[index]);
  const right = correct.filter(Boolean).length;
  const grade: Grade =
    right === correct.length ? "good" : right * 2 >= correct.length ? "hard" : "again";
  return ok({ grade, correct });
};
