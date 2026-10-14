import { PitchDetector } from "pitchy";
import { err, ok, type Result } from "./result.ts";

/** Changes with the contour of a given signal: stored in the audio pack index, a different value means a rebuild. */
export const F0_VERSION = "pitchy-4.1.0/v1";

export const POINTS_PER_SYLLABLE = 10;

/**
 * Per syllable, `POINTS_PER_SYLLABLE` points in tenths of a semitone relative to the median pitch of the
 * recording; `null` where nothing is voiced (silence is never bridged).
 */
export type Contour = readonly (number | null)[];

export type F0Error = "invalid-input" | "no-voice";

const WINDOW_SECONDS = 0.04;
const HOP_SECONDS = 0.01;
const MIN_SAMPLE_RATE = 8_000;
/** McLeod clarity below which a frame counts as unvoiced; 0.9 loses the breathy end of falling tones (HSK 1 recordings). */
const MIN_CLARITY = 0.5;
/** Frames quieter than this share of the loudest one are unvoiced. */
const MIN_LEVEL = 0.03;
/** Adult speech, with room for a high female or child voice. */
const MIN_HZ = 70;
const MAX_HZ = 500;
/** A real jump between voiced frames stays; a bigger one is read as an octave error. */
const MAX_JUMP_SEMITONES = 8;
/** Share of a syllable's duration its boundary may move to reach a quieter frame. */
const SNAP_RATIO = 0.25;

const inRange = (hz: number): boolean => hz >= MIN_HZ && hz <= MAX_HZ;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/**
 * Brings each pitch back to the octave closest to the previous voiced frame, the median of the recording
 * for the first one, and drops what no octave puts in the speech range. pitchy alone reads 260 Hz as 520 Hz
 * on the #112 samples.
 */
export const unfoldOctaves = (raw: readonly (number | null)[]): (number | null)[] => {
  const pool = raw.filter((hz): hz is number => hz !== null);
  let reference = median(pool);
  return raw.map((hz) => {
    if (hz === null) return null;
    const nearReference = (candidate: number): boolean =>
      Math.abs(12 * Math.log2(candidate / reference)) <= MAX_JUMP_SEMITONES;
    if (inRange(hz) && nearReference(hz)) {
      reference = hz;
      return hz;
    }
    const best = [hz / 2, hz, hz * 2]
      .filter(inRange)
      .reduce<number | null>(
        (closest, candidate) =>
          closest === null ||
          Math.abs(Math.log2(candidate / reference)) < Math.abs(Math.log2(closest / reference))
            ? candidate
            : closest,
        null,
      );
    if (best !== null) reference = best;
    return best;
  });
};

type Frames = { readonly levels: number[]; readonly raw: (number | null)[] };

const analyse = (samples: Float32Array, sampleRate: number): Frames => {
  const window = Math.round(sampleRate * WINDOW_SECONDS);
  const hop = Math.round(sampleRate * HOP_SECONDS);
  const detector = PitchDetector.forFloat32Array(window);
  const levels: number[] = [];
  const pitches: { hz: number; clarity: number }[] = [];
  for (let at = 0; at + window <= samples.length; at += hop) {
    const frame = samples.subarray(at, at + window);
    let energy = 0;
    for (const value of frame) energy += value * value;
    levels.push(Math.sqrt(energy / window));
    const [hz, clarity] = detector.findPitch(frame, sampleRate);
    pitches.push({ hz, clarity });
  }
  const threshold = Math.max(0, ...levels) * MIN_LEVEL;
  const raw = pitches.map(({ hz, clarity }, index) =>
    clarity >= MIN_CLARITY && (levels[index] ?? 0) >= threshold && hz >= MIN_HZ && hz <= 2 * MAX_HZ
      ? hz
      : null,
  );
  return { levels, raw };
};

/**
 * The pitch contour of one spoken word of `syllables` syllables. Syllables are cut in equal parts of the
 * voiced stretch, each boundary moved to the quietest frame nearby; the same cut serves the reference
 * recordings and the learner's voice, so both curves line up.
 */
export const contour = (
  samples: Float32Array,
  sampleRate: number,
  syllables: number,
): Result<Contour, F0Error> => {
  if (!Number.isInteger(syllables) || syllables < 1) return err("invalid-input");
  if (!Number.isFinite(sampleRate) || sampleRate < MIN_SAMPLE_RATE) return err("invalid-input");
  const { levels, raw } = analyse(samples, sampleRate);
  const hz = unfoldOctaves(raw);
  const voiced = hz.flatMap((value, index) => (value === null ? [] : [index]));
  const first = voiced.at(0) ?? null;
  const last = voiced.at(-1) ?? null;
  if (first === null || last === null) return err("no-voice");

  const center = median(voiced.map((index) => hz[index] ?? 0));
  const tenths = hz.map((value) =>
    value === null ? null : Math.round(120 * Math.log2(value / center)),
  );

  const span = last + 1 - first;
  const snap = Math.floor((SNAP_RATIO * span) / syllables);
  const bounds = Array.from({ length: syllables + 1 }, (_, boundary) => {
    const at = first + Math.round((boundary * span) / syllables);
    if (boundary === 0 || boundary === syllables) return at;
    let quietest = at;
    for (let index = Math.max(first, at - snap); index <= Math.min(last, at + snap); index++) {
      if ((levels[index] ?? Infinity) < (levels[quietest] ?? Infinity)) quietest = index;
    }
    return quietest;
  });

  const points: (number | null)[] = [];
  for (let syllable = 0; syllable < syllables; syllable++) {
    const from = bounds[syllable] ?? first;
    const to = bounds[syllable + 1] ?? last + 1;
    for (let point = 0; point < POINTS_PER_SYLLABLE; point++) {
      const low = from + Math.floor(((to - from) * point) / POINTS_PER_SYLLABLE);
      const high = Math.max(
        low + 1,
        from + Math.floor(((to - from) * (point + 1)) / POINTS_PER_SYLLABLE),
      );
      const values = tenths
        .slice(low, Math.min(high, to))
        .filter((value): value is number => value !== null);
      points.push(
        values.length === 0
          ? null
          : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
      );
    }
  }
  return ok(points);
};
