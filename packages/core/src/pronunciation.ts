import { POINTS_PER_SYLLABLE, type Contour } from "./f0.ts";
import { err, ok, type Result } from "./result.ts";
import { classifyTone, toneFeatures, type ToneClass } from "./tone-classifier.ts";

/**
 * Confidence from which the expected tone is told as heard, and another tone. Measured 2026-10-15 on
 * Lingua Libre two-syllable words, one speaker left out: 2 % of wrong syllables told right, 2 % of
 * right ones told another tone, the rest « not sure » (ADR 0007).
 */
export const RIGHT_CONFIDENCE = 0.3;
export const OTHER_CONFIDENCE = 0.4;

export type SyllableVerdict =
  | { readonly kind: "right" }
  | { readonly kind: "other"; readonly tone: ToneClass }
  | { readonly kind: "unsure" }
  /** The neutral tone is not classified. */
  | { readonly kind: "neutral" }
  | { readonly kind: "unvoiced" };

export type SyllableScore = {
  readonly verdict: SyllableVerdict;
  /** Root mean square gap to the reference syllable in semitones, to the tenth; `null` when either is unvoiced. */
  readonly distance: number | null;
};

export type PronunciationError = { readonly kind: "length-mismatch" };

const slice = (contour: Contour, syllable: number): Contour =>
  contour.slice(syllable * POINTS_PER_SYLLABLE, (syllable + 1) * POINTS_PER_SYLLABLE);

const distance = (voice: Contour, reference: Contour): number | null => {
  const a = toneFeatures(voice);
  const b = toneFeatures(reference);
  if (!a.ok || !b.ok) return null;
  let squared = 0;
  for (let at = 0; at < POINTS_PER_SYLLABLE; at++) {
    squared += ((a.value[at] ?? 0) - (b.value[at] ?? 0)) ** 2;
  }
  return Math.round(Math.sqrt(squared / POINTS_PER_SYLLABLE)) / 10;
};

const verdict = (voice: Contour, tone: number): SyllableVerdict => {
  const guess = classifyTone(voice);
  if (!guess.ok) return { kind: "unvoiced" };
  if (tone === 5) return { kind: "neutral" };
  if (guess.value.tone === tone) {
    return guess.value.confidence >= RIGHT_CONFIDENCE ? { kind: "right" } : { kind: "unsure" };
  }
  return guess.value.confidence >= OTHER_CONFIDENCE
    ? { kind: "other", tone: guess.value.tone }
    : { kind: "unsure" };
};

/**
 * Each syllable of a learner's word against the tones expected (1–5, after sandhi) and the
 * reference recording's contour: the tone heard by the classifier when it is confident, and the
 * distance to the reference curve.
 */
export const scorePronunciation = (
  voice: Contour,
  reference: Contour,
  tones: readonly number[],
): Result<readonly SyllableScore[], PronunciationError> => {
  const points = tones.length * POINTS_PER_SYLLABLE;
  if (tones.length === 0 || voice.length !== points || reference.length !== points) {
    return err({ kind: "length-mismatch" });
  }
  return ok(
    tones.map((tone, syllable) => ({
      verdict: verdict(slice(voice, syllable), tone),
      distance: distance(slice(voice, syllable), slice(reference, syllable)),
    })),
  );
};
