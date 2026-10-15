const FRAME_SECONDS = 0.01;
/** Quiet after the voice that ends a recording. */
const QUIET_SECONDS = 0.7;
/** A frame under this share of the loudest one is quiet. */
const QUIET_SHARE = 0.1;
/** Loudest frame under which nothing was said (full scale is 1): a muted or silent microphone. */
const MIN_PEAK = 0.01;

/** The longest recording of a word, in seconds. */
export const maxSeconds = (syllables: number): number => 2 + syllables;

export const joinSamples = (blocks: readonly Float32Array[]): Float32Array => {
  const joined = new Float32Array(blocks.reduce((length, block) => length + block.length, 0));
  let at = 0;
  for (const block of blocks) {
    joined.set(block, at);
    at += block.length;
  }
  return joined;
};

/** True once something loud enough was said and `QUIET_SECONDS` of quiet followed it. */
export const speechEnded = (samples: Float32Array, sampleRate: number): boolean => {
  const frame = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const levels: number[] = [];
  for (let start = 0; start + frame <= samples.length; start += frame) {
    let energy = 0;
    for (let at = start; at < start + frame; at++) energy += (samples[at] ?? 0) ** 2;
    levels.push(Math.sqrt(energy / frame));
  }
  const peak = Math.max(0, ...levels);
  if (peak < MIN_PEAK) return false;
  const loud = levels.findLastIndex((level) => level >= peak * QUIET_SHARE);
  return (levels.length - 1 - loud) * FRAME_SECONDS >= QUIET_SECONDS;
};
