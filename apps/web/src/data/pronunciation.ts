import {
  contour,
  err,
  ok,
  POINTS_PER_SYLLABLE,
  type Contour,
  type F0Error,
  type Result,
} from "@openlinguo/core";
import { database } from "./database.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

/** Enough for a voice's pitch; the pitch fixtures are decoded at this rate too. */
const DECODE_RATE = 16_000;

export type ReferenceError =
  | ReviewLogFailure
  | { readonly kind: "gone" }
  | { readonly kind: "undecodable"; readonly message: string }
  | { readonly kind: F0Error };

/**
 * The pitch contour of a word's pack recording: the one stored with the pack, or computed here by
 * the same function for packs made before contours were shipped (ADR 0007).
 */
export const referenceContour = async (
  id: string,
  syllables: number,
): Promise<Result<Contour, ReferenceError>> => {
  const row = await guarded(async () => ok((await database.wordAudio.get(id)) ?? null));
  if (!row.ok) return row;
  if (row.value === null) return err({ kind: "gone" });
  const { f0, data } = row.value;
  if (f0 !== null && f0.length === syllables * POINTS_PER_SYLLABLE) return ok(f0);
  let buffer: AudioBuffer;
  try {
    buffer = await new OfflineAudioContext(1, 1, DECODE_RATE).decodeAudioData(data.slice(0));
  } catch (error) {
    return err({ kind: "undecodable", message: String(error) });
  }
  const computed = contour(buffer.getChannelData(0), buffer.sampleRate, syllables);
  return computed.ok ? computed : err({ kind: computed.error });
};
