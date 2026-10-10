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

export type PinyinFeatures = Pick<LanguageFeatures, "romanization" | "tones">;

/** A syllable with its tone marks and the class of its tone color (the mark carries the tone). */
export type PinyinSyllable = { readonly text: string; readonly color: string | null };

/** The syllables of a reading, or `null` when the pack cannot display it. */
export const pinyinSyllables = (
  reading: string,
  { romanization, tones }: PinyinFeatures,
): readonly PinyinSyllable[] | null => {
  const display = romanization?.toDisplay(reading) ?? null;
  const marks = tones?.tonesOf(reading) ?? null;
  if (display?.ok !== true || marks?.ok !== true) return null;
  return display.value.split(" ").map((text, index) => {
    const tone = marks.value[index] ?? null;
    return { text, color: tone === null ? null : (TONE_COLORS[tone] ?? null) };
  });
};

type Props = {
  readonly reading: string;
  readonly features: PinyinFeatures;
  readonly className: string | null;
};

/** A reading with its tone marks, each syllable in its tone color. */
export const Pinyin = ({ reading, features, className }: Props) => {
  const syllables = pinyinSyllables(reading, features);
  const classes = cn("font-zh", className);
  if (syllables === null) {
    return (
      <span lang="zh-Latn-pinyin" className={classes}>
        {reading}
      </span>
    );
  }
  return (
    <span lang="zh-Latn-pinyin" className={classes}>
      {syllables.map(({ text, color }, index) => (
        // Syllables never move: the index is a stable key.
        <Fragment key={index}>
          {index > 0 && " "}
          <span {...(color === null ? {} : { className: color })}>{text}</span>
        </Fragment>
      ))}
    </span>
  );
};
