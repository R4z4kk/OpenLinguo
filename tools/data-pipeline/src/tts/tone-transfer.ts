import {
  err,
  ok,
  POINTS_PER_SYLLABLE,
  TONE_CLASSES,
  type Contour,
  type Result,
  type ToneClass,
} from "@openlinguo/core";

/**
 * Tone transfer (#105, ADR 0007): a pinyin chart syllable missing in one tone is made from a recording of the
 * same syllable in another tone, its consonant and vowel kept and its pitch replaced by the voice's own contour
 * for the missing tone (tools/tts/world).
 */

/** Points of a WORLD contour over the voiced stretch, in semitones above 100 Hz (tools/tts/world/server.py). */
export const CONTOUR_POINTS = 20;

/** What WORLD measures in a recording: how long its voiced stretch lasts and the pitch over it. */
export type Analysis = { readonly seconds: number; readonly contour: readonly number[] };

export type ToneTemplate = Analysis;
export type ToneTemplates = Readonly<Record<ToneClass, ToneTemplate>>;

const TONE_OF: Readonly<Record<string, ToneClass>> = { "1": 1, "2": 2, "3": 3, "4": 4 };

/** The tone of a one-syllable reading key (`lu:4`); null for the neutral tone. */
export const toneOf = (reading: string): ToneClass | null =>
  TONE_OF[/[1-5]$/u.exec(reading)?.[0] ?? ""] ?? null;

/** The syllable of a one-syllable reading key without its tone: `lu:4` gives `lu:`. */
export const syllableOf = (reading: string): string => reading.replace(/[1-5]$/u, "");

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/** Each tone's mean contour, point by point, and median duration over the voice's recordings of it. */
export const toneTemplates = (
  recordings: readonly { readonly tone: ToneClass; readonly analysis: Analysis }[],
): Result<ToneTemplates, { readonly kind: "missing-tone"; readonly tone: ToneClass }> => {
  const missing = TONE_CLASSES.find((tone) => !recordings.some((r) => r.tone === tone)) ?? null;
  if (missing !== null) return err({ kind: "missing-tone", tone: missing });
  const template = (tone: ToneClass): ToneTemplate => {
    const own = recordings.filter((recording) => recording.tone === tone);
    return {
      contour: Array.from({ length: CONTOUR_POINTS }, (_, at) =>
        mean(own.map(({ analysis }) => analysis.contour[at] ?? 0)),
      ),
      seconds: median(own.map(({ analysis }) => analysis.seconds)),
    };
  };
  return ok({ 1: template(1), 2: template(2), 3: template(3), 4: template(4) });
};

/** How long the voiced stretch of a transfer lasts: the target tone's duration, scaled as the source is to its own. */
export const transferSeconds = (
  templates: ToneTemplates,
  sourceTone: ToneClass,
  sourceSeconds: number,
  targetTone: ToneClass,
): number => (templates[targetTone].seconds * sourceSeconds) / templates[sourceTone].seconds;

/**
 * Whether a recording can be a source: a voiced stretch under half or over twice its tone's usual length was
 * mis-measured (a breathy vowel WORLD hears as unvoiced) or runs on past the syllable.
 */
export const usableSource = (
  analysis: Analysis,
  tone: ToneClass,
  templates: ToneTemplates,
): boolean => {
  const ratio = analysis.seconds / templates[tone].seconds;
  return ratio >= 0.5 && ratio <= 2;
};

/** A template as the app draws a contour (core f0.ts): ten points in tenths of a semitone around the median. */
export const templateShape = (template: ToneTemplate): number[] => {
  const center = median(template.contour);
  const per = CONTOUR_POINTS / POINTS_PER_SYLLABLE;
  return Array.from({ length: POINTS_PER_SYLLABLE }, (_, point) =>
    Math.round(10 * (mean(template.contour.slice(point * per, (point + 1) * per)) - center)),
  );
};

/**
 * How far a contour measured by the app's own pitch code (core f0.ts) is from a template's shape: the RMS of the
 * differences over the voiced points, their mean removed, in semitones. Null when fewer than half are voiced.
 */
export const pitchDistance = (contour: Contour, template: ToneTemplate): number | null => {
  const shape = templateShape(template);
  const differences = contour.flatMap((point, at) =>
    point === null ? [] : [point - (shape[at] ?? 0)],
  );
  if (differences.length < POINTS_PER_SYLLABLE / 2) return null;
  const offset = mean(differences);
  return Math.sqrt(mean(differences.map((value) => (value - offset) ** 2))) / 10;
};

/**
 * For each tone, the distance to the template under which `share` of the voice's recordings of that tone fall:
 * a transfer further than this is not the contour it was given. 0 when a tone has no voiced recording.
 */
export const pitchLimits = (
  recordings: readonly { readonly tone: ToneClass; readonly contour: Contour }[],
  templates: ToneTemplates,
  share: number,
): Readonly<Record<ToneClass, number>> => {
  const limit = (tone: ToneClass): number => {
    const distances = recordings
      .filter((recording) => recording.tone === tone)
      .flatMap(({ contour }) => {
        const distance = pitchDistance(contour, templates[tone]);
        return distance === null ? [] : [distance];
      })
      .sort((a, b) => a - b);
    return distances[Math.max(0, Math.ceil(share * distances.length) - 1)] ?? 0;
  };
  return { 1: limit(1), 2: limit(2), 3: limit(3), 4: limit(4) };
};

export type SourceKind = "shipped" | "tone-doubted" | "seed";

/** A recording whose syllable the recognizer heard right, usable as a transfer source. */
export type Source = { readonly key: string; readonly reading: string; readonly kind: SourceKind };

/**
 * The recordings a transfer can start from, by syllable: one syllable in tones 1 to 4, its syllable heard right
 * (`heard`, the recognizer check without tones) or validated by ear, never rejected by ear. One whose tone was doubted
 * still has the right consonant and vowel; a seed was recorded only to be a source.
 */
export const transferSources = ({
  recordings,
  seeds,
  reviews,
  heard,
}: {
  readonly recordings: Iterable<
    readonly [
      key: string,
      saved: { readonly transcript: string | null; readonly pass: boolean | null },
    ]
  >;
  readonly seeds: ReadonlySet<string>;
  readonly reviews: Readonly<Record<string, "ok" | "bad">>;
  readonly heard: (reading: string, transcript: string) => boolean;
}): Map<string, Source[]> => {
  const sources = new Map<string, Source[]>();
  for (const [key, { transcript, pass }] of recordings) {
    const reading = key.split("\t")[1] ?? "";
    if (reading.includes(" ") || toneOf(reading) === null || reviews[key] === "bad") continue;
    if (reviews[key] !== "ok" && (transcript === null || !heard(reading, transcript))) continue;
    const kind: SourceKind = seeds.has(key)
      ? "seed"
      : pass === true || reviews[key] === "ok"
        ? "shipped"
        : "tone-doubted";
    const syllable = syllableOf(reading);
    sources.set(syllable, [...(sources.get(syllable) ?? []), { key, reading, kind }]);
  }
  return sources;
};

const KIND_ORDER: readonly SourceKind[] = ["shipped", "tone-doubted", "seed"];
/**
 * Measured on the pinyin chart (#105): transfers from a tone 3 recording kept their syllable best (the recognizer
 * heard it in 64.6 % of them), then from tones 2 (63.9 %), 1 (56.2 %) and 4 (51.0 %).
 */
const TONE_ORDER: readonly (ToneClass | null)[] = [3, 2, 1, 4, null];

/** Sources in the order they are tried: shipped first, tone-doubted next, seeds last; then by tone. */
export const rankSources = (sources: readonly Source[]): Source[] =>
  [...sources].sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      TONE_ORDER.indexOf(toneOf(a.reading)) - TONE_ORDER.indexOf(toneOf(b.reading)) ||
      a.key.localeCompare(b.key),
  );
