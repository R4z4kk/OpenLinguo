import type { AnnotatedToken, Knowledge, ReadingChoices } from "@openlinguo/core";
import {
  Fragment,
  memo,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { pinyinSyllables, type PinyinFeatures } from "@/components/pinyin";
import type { Paragraph } from "@/data/reader";
import type { PinyinMode } from "@/data/reader-settings";
import { rubyPairs } from "@/lib/ruby";
import { cn } from "@/lib/utils";

type WordProps = {
  readonly start: number;
  readonly text: string;
  readonly unknown: boolean;
  /** The pinyin to show above the characters, `null` where none is shown. */
  readonly reading: string | null;
  readonly polyphone: boolean;
  readonly selected: boolean;
  readonly tabbable: boolean;
  /** Room above the word for the pinyin, in the box of the word and not in the line height. */
  readonly roomy: boolean;
  readonly features: PinyinFeatures;
  readonly unknownId: string;
  readonly readingsId: string;
};

const Word = memo(
  ({
    start,
    text,
    unknown,
    reading,
    polyphone,
    selected,
    tabbable,
    roomy,
    features,
    unknownId,
    readingsId,
  }: WordProps) => {
    const syllables = reading === null ? null : pinyinSyllables(reading, features);
    const underline = unknown
      ? "underline decoration-dotted decoration-2 underline-offset-[7px]"
      : "";
    const described = [unknown ? unknownId : "", polyphone ? readingsId : ""].filter(
      (id) => id !== "",
    );
    return (
      <button
        type="button"
        data-start={start}
        tabIndex={tabbable ? 0 : -1}
        {...(selected ? { "aria-current": true } : {})}
        {...(described.length === 0 ? {} : { "aria-describedby": described.join(" ") })}
        className={cn(
          "cursor-pointer rounded-sm",
          roomy && "pt-6",
          underline,
          selected && "ring-2 ring-ink",
        )}
      >
        {syllables === null ? (
          text
        ) : (
          <ruby>
            {rubyPairs(text, syllables).map(([base, annotation], index) => (
              // Characters never move: the index is a stable key.
              <Fragment key={index}>
                {base}
                <rt
                  lang="zh-Latn-pinyin"
                  className={cn(
                    "px-0.5 font-zh text-[14px] leading-4 font-medium",
                    annotation.length === 1 && annotation[0]?.color,
                  )}
                >
                  {annotation.length === 1
                    ? annotation[0]?.text
                    : annotation.map(({ text: syllable, color }, position) => (
                        <Fragment key={position}>
                          {position > 0 && " "}
                          <span {...(color === null ? {} : { className: color })}>{syllable}</span>
                        </Fragment>
                      ))}
                </rt>
              </Fragment>
            ))}
          </ruby>
        )}
        {polyphone && (
          <span
            aria-hidden="true"
            className="relative -top-2 ml-0.5 inline-block size-[7px] rotate-45 bg-ink"
          />
        )}
      </button>
    );
  },
);

type Props = {
  readonly tokens: readonly AnnotatedToken[];
  readonly paragraphs: readonly Paragraph[];
  readonly knowledge: readonly Knowledge[];
  /** Spoken pinyin per token, `null` when the text cannot be read as pinyin. */
  readonly spoken: readonly (string | null)[] | null;
  readonly choices: ReadingChoices;
  readonly mode: PinyinMode;
  readonly features: PinyinFeatures;
  /** `start` of the selected word's token, `null` for none. */
  readonly selected: number | null;
  readonly onSelect: (start: number | null) => void;
  readonly unknownId: string;
  readonly readingsId: string;
};

const wordButton = (target: EventTarget): HTMLElement | null =>
  target instanceof Element ? target.closest<HTMLElement>("button[data-start]") : null;

const startOf = (button: HTMLElement | null): number | null => {
  const start = Number.parseInt(button?.dataset["start"] ?? "", 10);
  return Number.isNaN(start) ? null : start;
};

/**
 * One `p` per paragraph and one native button per word. The words are one tab stop (roving
 * tabindex): ← → Home End move along them and Tab comes back to the last one visited. The
 * container has no widget role, so screen readers keep reading the text in browse mode.
 */
export const Passage = ({
  tokens,
  paragraphs,
  knowledge,
  spoken,
  choices,
  mode,
  features,
  selected,
  onSelect,
  unknownId,
  readingsId,
}: Props) => {
  const container = useRef<HTMLDivElement>(null);
  const [stop, setStop] = useState<number | null>(null);
  const starts = useMemo(
    () =>
      paragraphs.flatMap((paragraph) =>
        paragraph.flatMap((item) => {
          const token = item.kind === "word" ? (tokens[item.index] ?? null) : null;
          return token === null ? [] : [token.start];
        }),
      ),
    [paragraphs, tokens],
  );
  const tabStop = stop ?? starts[0] ?? null;

  const select = (event: MouseEvent): void => {
    const start = startOf(wordButton(event.target));
    if (start === null) return;
    setStop(start);
    onSelect(selected === start ? null : start);
  };

  const move = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === "Escape") {
      if (selected !== null) onSelect(null);
      return;
    }
    const position = starts.indexOf(startOf(wordButton(event.target)) ?? -1);
    if (position < 0) return;
    const targets: Readonly<Record<string, number>> = {
      ArrowRight: position + 1,
      ArrowLeft: position - 1,
      Home: 0,
      End: starts.length - 1,
    };
    const target = targets[event.key];
    if (target == null) return;
    event.preventDefault();
    const next = starts[target];
    if (next != null)
      container.current
        ?.querySelector<HTMLElement>(`button[data-start="${String(next)}"]`)
        ?.focus();
  };

  return (
    // eslint-disable-next-line jsx-a11y-x/no-static-element-interactions -- Events bubble from the word buttons, so the keys only work while focus is on a word.
    <div
      ref={container}
      onClick={select}
      onFocus={(event) => {
        const start = startOf(wordButton(event.target));
        if (start !== null) setStop(start);
      }}
      onKeyDown={move}
      className="rounded-card border border-hairline bg-surface p-3"
    >
      {paragraphs.map((paragraph, paragraphIndex) => (
        <p
          // Paragraphs never move: the index is a stable key.
          key={paragraphIndex}
          lang="zh-Hans"
          className={cn(
            "px-1 py-1 font-zh text-[20px] [contain-intrinsic-size:auto_5rem] [content-visibility:auto]",
            mode === "none" ? "leading-9" : "leading-8",
          )}
        >
          {paragraph.map((item, itemIndex) => {
            if (item.kind === "text") return <Fragment key={itemIndex}>{item.text}</Fragment>;
            const token = tokens[item.index];
            if (token == null) return null;
            const unknown = (knowledge[item.index] ?? "unknown") !== "known";
            const shown = mode === "all" || (mode === "unknown" && unknown);
            const reading = shown ? (spoken?.[item.index] ?? null) : null;
            const picked = choices[token.start];
            const polyphone =
              reading !== null &&
              token.ambiguous &&
              !(picked != null && token.readings.includes(picked));
            return (
              <span key={itemIndex} className="whitespace-nowrap">
                {item.before}
                <Word
                  start={token.start}
                  text={token.text}
                  unknown={unknown}
                  reading={reading}
                  polyphone={polyphone}
                  selected={selected === token.start}
                  tabbable={tabStop === token.start}
                  roomy={mode !== "none"}
                  features={features}
                  unknownId={unknownId}
                  readingsId={readingsId}
                />
                {item.after}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
};
