import type { Contour } from "./f0.ts";
import { err, ok, type Result } from "./result.ts";
import {
  classifyTone,
  MIN_CONFIDENCE,
  trainToneModel,
  type ToneClass,
  type ToneError,
  type ToneTrainingError,
} from "./tone-classifier.ts";

/**
 * Measured 2026-10-15 on 289 isolated syllables of 3 speakers, one left out, with the low-passed
 * contours (`F0_VERSION` v2): 64.7 % right, and 80.5 % right on the 55.0 % of guesses at or above
 * `MIN_CONFIDENCE` (ADR 0007). The floors sit a few points under; the fixture tests, in Node and in
 * the browsers, fail below them.
 */
export const ACCURACY_FLOOR = 0.6;
export const CONFIDENT_COVERAGE_FLOOR = 0.48;
export const CONFIDENT_ACCURACY_FLOOR = 0.74;

export type ToneExample = {
  readonly speaker: string;
  readonly tone: ToneClass;
  readonly contour: Contour;
};

export type ToneRates = {
  readonly accuracy: number;
  /** Share of the guesses at or above `MIN_CONFIDENCE`. */
  readonly coverage: number;
  readonly confidentAccuracy: number;
};

/** Each speaker's examples classified by a model trained on the other speakers. */
export const leaveOneSpeakerOut = (
  examples: readonly ToneExample[],
): Result<ToneRates, ToneTrainingError | ToneError> => {
  let guesses = 0;
  let right = 0;
  let confident = 0;
  let confidentRight = 0;
  for (const speaker of new Set(examples.map((example) => example.speaker))) {
    const model = trainToneModel(examples.filter((example) => example.speaker !== speaker));
    if (!model.ok) return err(model.error);
    for (const example of examples.filter((candidate) => candidate.speaker === speaker)) {
      const guess = classifyTone(example.contour, model.value);
      if (!guess.ok) return err(guess.error);
      const correct = guess.value.tone === example.tone;
      guesses += 1;
      if (correct) right += 1;
      if (guess.value.confidence >= MIN_CONFIDENCE) {
        confident += 1;
        if (correct) confidentRight += 1;
      }
    }
  }
  return ok({
    accuracy: right / Math.max(1, guesses),
    coverage: confident / Math.max(1, guesses),
    confidentAccuracy: confidentRight / Math.max(1, confident),
  });
};
