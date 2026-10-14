import { POINTS_PER_SYLLABLE, type Contour } from "./f0.ts";
import { err, ok, type Result } from "./result.ts";
import { TONE_MODEL } from "./tone-model.ts";

export type ToneClass = 1 | 2 | 3 | 4;

/** The order of a model's centroids. The neutral tone is not classified. */
export const TONE_CLASSES = [1, 2, 3, 4] as const satisfies readonly ToneClass[];

export type ToneModel = {
  /** One centroid per tone, in `TONE_CLASSES` order, over `toneFeatures`. */
  readonly centroids: readonly (readonly number[])[];
  /** Standard deviation of each feature over the training set. */
  readonly scale: readonly number[];
};

export type ToneGuess = {
  readonly tone: ToneClass;
  /** 0 to 1: how much closer the tone is than the runner-up. */
  readonly confidence: number;
};

export type ToneError =
  { readonly kind: "unvoiced" } | { readonly kind: "bad-contour"; readonly points: number };

export type ToneTrainingError =
  ToneError | { readonly kind: "missing-tone"; readonly tone: ToneClass };

/**
 * Below this confidence a guess is not shown. On the fixtures (isolated syllables, one speaker
 * left out) it keeps about four guesses in ten, three in four right (ADR 0007).
 */
export const MIN_CONFIDENCE = 0.2;

/** Tenths of a semitone per unvoiced point: creaky low tones lose frames. */
const UNVOICED_WEIGHT = 10;

/**
 * The ten points with unvoiced ones filled in from their neighbours, then the unvoiced count: what
 * the model compares.
 */
export const toneFeatures = (contour: Contour): Result<readonly number[], ToneError> => {
  if (contour.length !== POINTS_PER_SYLLABLE) {
    return err({ kind: "bad-contour", points: contour.length });
  }
  const voiced = contour.flatMap((value, index) => (value === null ? [] : [index]));
  if (voiced.length === 0) return err({ kind: "unvoiced" });
  const value = (index: number): number => contour[index] ?? 0;
  const filled = contour.map((point, index) => {
    if (point !== null) return point;
    const before = voiced.findLast((at) => at < index) ?? null;
    const after = voiced.find((at) => at > index) ?? null;
    if (before === null) return value(after ?? index);
    if (after === null) return value(before);
    return value(before) + ((value(after) - value(before)) * (index - before)) / (after - before);
  });
  return ok([...filled, (POINTS_PER_SYLLABLE - voiced.length) * UNVOICED_WEIGHT]);
};

const round = (value: number): number => Math.round(value * 10) / 10;
const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/** The centroids and scales, to the tenth, so a trained model is a short constant. */
export const trainToneModel = (
  examples: readonly { readonly tone: ToneClass; readonly contour: Contour }[],
): Result<ToneModel, ToneTrainingError> => {
  const rows: { readonly tone: ToneClass; readonly features: readonly number[] }[] = [];
  for (const { tone, contour } of examples) {
    const features = toneFeatures(contour);
    if (!features.ok) return features;
    rows.push({ tone, features: features.value });
  }
  const width = POINTS_PER_SYLLABLE + 1;
  const column = (rowsOf: typeof rows, at: number): number[] =>
    rowsOf.map(({ features }) => features[at] ?? 0);
  const scale = Array.from({ length: width }, (_, at) => {
    const values = column(rows, at);
    const center = mean(values);
    const spread = Math.sqrt(mean(values.map((value) => (value - center) ** 2)));
    return round(spread) || 1;
  });
  const centroids: number[][] = [];
  for (const tone of TONE_CLASSES) {
    const own = rows.filter((row) => row.tone === tone);
    if (own.length === 0) return err({ kind: "missing-tone", tone });
    centroids.push(Array.from({ length: width }, (_, at) => round(mean(column(own, at)))));
  }
  return ok({ centroids, scale });
};

/**
 * The tone of one syllable's contour, nearest centroid in feature units, with how clear the win
 * is. Callers show the tone only from `MIN_CONFIDENCE`.
 */
export const classifyTone = (
  contour: Contour,
  model: ToneModel = TONE_MODEL,
): Result<ToneGuess, ToneError> => {
  const features = toneFeatures(contour);
  if (!features.ok) return features;
  const ranked = TONE_CLASSES.map((tone, index) => {
    const centroid = model.centroids[index] ?? [];
    const squared = features.value.reduce((sum, value, at) => {
      const gap = (value - (centroid[at] ?? 0)) / (model.scale[at] ?? 1);
      return sum + gap * gap;
    }, 0);
    return { tone, distance: Math.sqrt(squared) };
  }).sort((a, b) => a.distance - b.distance);
  const best = ranked[0] ?? null;
  const second = ranked[1] ?? null;
  if (best === null || second === null) return err({ kind: "unvoiced" });
  const confidence = second.distance === 0 ? 0 : 1 - best.distance / second.distance;
  return ok({ tone: best.tone, confidence });
};
