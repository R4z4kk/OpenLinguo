import {
  classifyTone,
  MIN_CONFIDENCE,
  ok,
  trainToneModel,
  type Contour,
  type Result,
  type ToneClass,
  type ToneTrainingError,
} from "@openlinguo/core";

export type SyllableRecording = {
  readonly key: string;
  readonly tone: ToneClass;
  readonly contour: Contour;
  /** The character the recognizer heard can carry the tone (heardToneMatches). */
  readonly heardTone: boolean;
};

/**
 * Isolated syllables whose tone two independent signals doubt (ADR 0007): the recognizer heard a character of
 * another tone, and a tone model of this voice, trained on the recordings whose character agrees, confidently
 * hears another tone. Neither signal is reliable alone (92 % and 82 % agreement on the packs).
 */
export const toneDoubts = (
  recordings: readonly SyllableRecording[],
): Result<ReadonlySet<string>, ToneTrainingError> => {
  const model = trainToneModel(recordings.filter((recording) => recording.heardTone));
  if (!model.ok) return model;
  const doubted = recordings.filter((recording) => {
    if (recording.heardTone) return false;
    const guess = classifyTone(recording.contour, model.value);
    return (
      guess.ok && guess.value.confidence >= MIN_CONFIDENCE && guess.value.tone !== recording.tone
    );
  });
  return ok(new Set(doubted.map((recording) => recording.key)));
};
