import { Fragment } from "react";
import { rubyPairs } from "@/lib/ruby";
import { cn } from "@/lib/utils";
import { pinyinSyllables, type PinyinFeatures } from "./pinyin.tsx";

const SIZES = {
  display: { base: "text-display", annotation: "text-pinyin" },
  title: { base: "text-title font-normal", annotation: "text-small" },
} as const;

type Props = {
  readonly word: string;
  readonly reading: string;
  readonly features: PinyinFeatures;
  readonly size: keyof typeof SIZES;
};

/** A word with its pinyin as ruby, each syllable over its character in its tone color. */
export const RubyWord = ({ word, reading, features, size }: Props) => {
  const syllables = pinyinSyllables(reading, features) ?? [{ text: reading, color: null }];
  return (
    <ruby lang="zh-Hans" className={cn("font-display", SIZES[size].base)}>
      {rubyPairs(word, syllables).map(([base, annotation], index) => (
        // Characters never move: the index is a stable key.
        <Fragment key={index}>
          {base}
          <rt lang="zh-Latn-pinyin" className={cn("font-zh", SIZES[size].annotation)}>
            {annotation.map(({ text, color }, position) => (
              <Fragment key={position}>
                {position > 0 && " "}
                <span {...(color === null ? {} : { className: color })}>{text}</span>
              </Fragment>
            ))}
          </rt>
        </Fragment>
      ))}
    </ruby>
  );
};
