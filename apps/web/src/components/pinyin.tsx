import type { LanguageFeatures } from "@openlinguo/core";
import { Fragment } from "react";
import { cn } from "@/lib/utils";

const TONE_COLORS: Readonly<Record<number, string>> = {
  1: "text-tone-1",
  2: "text-tone-2",
  3: "text-tone-3",
  4: "text-tone-4",
  5: "text-tone-neutral",
};

type Props = {
  readonly reading: string;
  readonly features: Pick<LanguageFeatures, "romanization" | "tones">;
  readonly className: string | null;
};

/** A reading with its tone marks, each syllable in its tone color (the mark carries the tone). */
export const Pinyin = ({ reading, features: { romanization, tones }, className }: Props) => {
  const display = romanization?.toDisplay(reading) ?? null;
  const marks = tones?.tonesOf(reading) ?? null;
  const classes = cn("font-zh", className);
  if (display?.ok !== true || marks?.ok !== true) {
    return (
      <span lang="zh-Latn-pinyin" className={classes}>
        {reading}
      </span>
    );
  }
  return (
    <span lang="zh-Latn-pinyin" className={classes}>
      {display.value.split(" ").map((syllable, index) => {
        const tone = marks.value[index] ?? null;
        const color = tone === null ? null : (TONE_COLORS[tone] ?? null);
        return (
          // Syllables never move: the index is a stable key.
          <Fragment key={index}>
            {index > 0 && " "}
            <span {...(color === null ? {} : { className: color })}>{syllable}</span>
          </Fragment>
        );
      })}
    </span>
  );
};
