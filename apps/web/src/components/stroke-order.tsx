import type { StrokeData } from "@openlinguo/core";
import { ChevronLeft, ChevronRight, Play, Square } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/lib/reduced-motion";
import { medianPath, polylineLength, strokeDuration } from "@/lib/strokes";

/** Wide enough to cover any stroke outline, which clips it. */
const MEDIAN_WIDTH = 200;
const PAUSE_MS = 150;

type Props = { readonly character: string; readonly data: StrokeData };

/**
 * Stroke order on a 米 grid: played on demand (never automatically), or stepped stroke by
 * stroke; under reduced motion the steps are the only mode, drawn without motion.
 */
export const StrokeOrder = ({ character, data }: Props) => {
  const { t } = useTranslation();
  const total = data.strokes.length;
  const reducedMotion = useReducedMotion();
  const [step, setStep] = useState(total);
  const [animating, setAnimating] = useState(false);
  const playing = animating && !reducedMotion;
  const median = useRef<SVGPathElement>(null);
  const clipId = `stroke-${useId().replace(/[^\w-]/gu, "")}`;
  const current = data.medians[step] ?? null;

  useEffect(() => {
    const path = median.current;
    if (!playing || path === null || current === null) return;
    const animation = path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
      duration: strokeDuration(polylineLength(current)),
      delay: PAUSE_MS,
      easing: "linear",
      fill: "forwards",
    });
    animation.onfinish = () => {
      setStep(step + 1);
      if (step + 1 === total) setAnimating(false);
    };
    return () => {
      animation.cancel();
    };
  }, [playing, step, total, current]);

  const fill = (index: number): string =>
    index >= step
      ? "fill-hairline"
      : playing || step === total || index === step - 1
        ? "fill-ink"
        : "fill-muted";

  return (
    <figure className="flex flex-col items-start gap-3">
      <svg
        viewBox="0 0 1024 1024"
        role="img"
        aria-label={t("word.strokeImage", { character })}
        className="size-64 rounded-card border border-hairline bg-surface text-ink"
      >
        <g className="stroke-hairline" strokeWidth={4} strokeDasharray="16 16" aria-hidden="true">
          <line x1={0} y1={0} x2={1024} y2={1024} />
          <line x1={1024} y1={0} x2={0} y2={1024} />
          <line x1={512} y1={0} x2={512} y2={1024} />
          <line x1={0} y1={512} x2={1024} y2={512} />
        </g>
        <g transform="translate(0 900) scale(1 -1)">
          {data.strokes.map((stroke, index) => (
            // Strokes never move: the index is a stable key.
            <path key={index} d={stroke} className={fill(index)} />
          ))}
          {playing && current !== null && (
            <>
              <clipPath id={clipId}>
                <path d={data.strokes[step] ?? ""} />
              </clipPath>
              <path
                key={step}
                ref={median}
                d={medianPath(current)}
                clipPath={`url(#${clipId})`}
                pathLength={1}
                strokeDasharray="1 2"
                strokeDashoffset={1}
                fill="none"
                stroke="currentColor"
                strokeWidth={MEDIAN_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}
        </g>
      </svg>
      <figcaption aria-live={playing ? "off" : "polite"} className="text-small text-muted">
        {step === total
          ? t("word.strokeCount", { count: total })
          : t("word.strokeStep", { step, total })}
      </figcaption>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          aria-label={t("word.previousStroke")}
          disabled={playing || step <= 1}
          onClick={() => {
            setStep(step - 1);
          }}
        >
          <ChevronLeft aria-hidden="true" className="size-5" />
        </Button>
        {!reducedMotion && (
          <Button
            variant="outline"
            onClick={() => {
              setStep(playing ? total : 0);
              setAnimating(!playing);
            }}
          >
            {playing ? (
              <Square aria-hidden="true" className="size-4" />
            ) : (
              <Play aria-hidden="true" className="size-4" />
            )}
            {t(playing ? "word.stop" : "word.play")}
          </Button>
        )}
        <Button
          variant="outline"
          aria-label={t("word.nextStroke")}
          disabled={playing || step >= total}
          onClick={() => {
            setStep(step + 1);
          }}
        >
          <ChevronRight aria-hidden="true" className="size-5" />
        </Button>
      </div>
    </figure>
  );
};
