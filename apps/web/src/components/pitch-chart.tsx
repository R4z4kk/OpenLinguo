import { POINTS_PER_SYLLABLE, type Contour } from "@openlinguo/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

const SYLLABLE_WIDTH = 100;
const HEIGHT = 100;
/** Smallest half range drawn, in tenths of a semitone: a flat tone stays flat. */
const MIN_RANGE = 60;

/** One path per voiced stretch: silence is never bridged. */
const pathOf = (contour: Contour, y: (value: number) => number): string =>
  contour
    .map((value, at) => {
      if (value === null) return "";
      const x = (at + 0.5) * (SYLLABLE_WIDTH / POINTS_PER_SYLLABLE);
      const joined = at > 0 && contour[at - 1] !== null;
      return `${joined ? "L" : "M"}${x.toFixed(1)} ${y(value).toFixed(1)}${joined ? "" : "h0.1"}`;
    })
    .join("");

/**
 * The reference pitch (dashed) and the learner's (solid), each relative to its own median, one
 * column per syllable. The text result next to it is its equivalent (WCAG 1.1.1).
 */
export const PitchChart = ({
  reference,
  voice,
  labels,
}: {
  readonly reference: Contour;
  readonly voice: Contour | null;
  readonly labels: readonly ReactNode[];
}) => {
  const { t } = useTranslation();
  const range = Math.max(
    MIN_RANGE,
    ...[...reference, ...(voice ?? [])].map((value) => Math.abs(value ?? 0)),
  );
  const y = (value: number): number => HEIGHT / 2 - (value / range) * (HEIGHT / 2 - 5);
  const width = labels.length * SYLLABLE_WIDTH;
  return (
    <figure className="flex w-full max-w-md flex-col gap-2">
      <svg
        viewBox={`0 0 ${String(width)} ${String(HEIGHT)}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t("speak.chart")}
        className="h-36 w-full rounded-card border border-hairline bg-surface"
      >
        <g className="stroke-hairline" strokeDasharray="4 4" vectorEffect="non-scaling-stroke">
          <line
            x1={0}
            y1={HEIGHT / 2}
            x2={width}
            y2={HEIGHT / 2}
            vectorEffect="non-scaling-stroke"
          />
          {labels.slice(1).map((_, index) => (
            <line
              // Syllables never move: the index is a stable key.
              key={index}
              x1={(index + 1) * SYLLABLE_WIDTH}
              y1={0}
              x2={(index + 1) * SYLLABLE_WIDTH}
              y2={HEIGHT}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
        <path
          d={pathOf(reference, y)}
          fill="none"
          className="stroke-muted"
          strokeWidth={2}
          strokeDasharray="6 4"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {voice !== null && (
          <path
            d={pathOf(voice, y)}
            fill="none"
            className="stroke-ink"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <ol aria-hidden="true" className="flex text-small">
        {labels.map((label, index) => (
          <li key={index} className="flex-1 text-center">
            {label}
          </li>
        ))}
      </ol>
      <figcaption className="text-small text-muted">{t("speak.legend")}</figcaption>
    </figure>
  );
};
