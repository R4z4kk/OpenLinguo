import { err, type ImeFeature } from "@openlinguo/core";
import { ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Pinyin, type PinyinFeatures } from "@/components/pinyin";
import { Button } from "@/components/ui/button";
import {
  CANDIDATES_PER_PAGE,
  commit,
  compositionOf,
  keyDown,
  lookupInput,
  looked,
  NOT_TYPING,
  turnPage,
  typed,
  type ImeCandidates,
  type ImeFieldState,
  type ImeTyping,
} from "@/data/ime-field";

/** Safari sends the Enter that ends a composition after `compositionend`, with this key code. */
const COMPOSITION_KEY_CODE = 229;

type Props = {
  readonly ime: ImeFeature;
  readonly features: PinyinFeatures;
  /** The characters committed: the answer. */
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Enter with no pinyin left to commit. */
  readonly onSubmit: () => void;
};

/**
 * The in-app pinyin input method: an ARIA combobox whose input holds the pinyin being typed, after
 * the characters committed, with the candidates in a listbox. The system's own input method passes
 * through.
 */
export const ImeField = ({ ime, features, value, onChange, onSubmit }: Props) => {
  const { t } = useTranslation();
  const id = useId();
  const [typing, setTyping] = useState<ImeTyping>(NOT_TYPING);
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const state: ImeFieldState = { ...typing, committed: value };
  const query = lookupInput(typing);

  useEffect(() => {
    if (query === null) return;
    let current = true;
    const settle = (candidates: ImeCandidates): void => {
      if (current) setTyping((now) => looked(now, { input: query, candidates }));
    };
    ime.candidates(query).then(settle, (error: unknown) => {
      settle(
        err({
          kind: "storage-failure",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    });
    return () => {
      current = false;
    };
  }, [ime, query]);

  const apply = ({ committed, ...next }: ImeFieldState): void => {
    setTyping(next);
    if (committed !== value) onChange(committed);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const outcome = keyDown(state, {
      key: event.key,
      composing:
        event.nativeEvent.isComposing ||
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- `key` is "Enter" in that event: only the key code tells it apart.
        event.nativeEvent.keyCode === COMPOSITION_KEY_CODE,
      modified: event.altKey || event.ctrlKey || event.metaKey,
    });
    if (outcome.kind === "pass") return;
    event.preventDefault();
    if (outcome.kind === "submit") onSubmit();
    else apply(outcome.state);
  };

  const ids = {
    input: `${id}-input`,
    committed: `${id}-committed`,
    listbox: `${id}-candidates`,
    option: (index: number) => `${id}-candidate-${String(index)}`,
  };
  const lookup = typing.buffer === "" ? null : typing.lookup;
  const shown = lookup?.candidates.ok === true ? lookup.candidates.value : [];
  const failure = lookup?.candidates.ok === false ? lookup.candidates.error : null;
  const expanded = shown.length > 0;
  const firstShown = Math.floor(typing.active / CANDIDATES_PER_PAGE) * CANDIDATES_PER_PAGE;
  const composition = compositionOf(typing.buffer);

  return (
    <div className="flex flex-col gap-2 text-left">
      <label htmlFor={ids.input} className="font-semibold">
        {t("ime.answer")}
      </label>
      <div className="flex min-h-13 items-stretch gap-0.5 rounded-control border border-border-strong bg-surface px-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink">
        <span
          id={ids.committed}
          lang="zh-Hans"
          aria-live="polite"
          className="self-center font-zh text-subtitle font-normal"
        >
          {value}
        </span>
        <div className="relative flex min-w-0 flex-1">
          <input
            ref={input}
            id={ids.input}
            type="text"
            role="combobox"
            aria-expanded={expanded}
            aria-controls={ids.listbox}
            aria-autocomplete="list"
            aria-describedby={ids.committed}
            {...(expanded ? { "aria-activedescendant": ids.option(typing.active) } : {})}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={typing.buffer}
            onChange={(event) => {
              apply(typed(state, event.target.value, composing.current));
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={(event) => {
              composing.current = false;
              apply(typed(state, event.currentTarget.value, false));
            }}
            onKeyDown={onKeyDown}
            className="w-full bg-transparent font-zh text-pinyin focus-visible:outline-none"
          />
          {/* Browsers draw no text decoration in inputs: the dotted underline is drawn under a copy. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 flex max-w-full items-center overflow-hidden"
          >
            <span className="border-b-2 border-dotted border-ink font-zh text-pinyin whitespace-pre text-transparent">
              {typing.buffer}
            </span>
          </span>
        </div>
      </div>
      {typing.buffer !== "" && (
        <div className="flex flex-col rounded-control border border-border-strong bg-surface p-1">
          <p className="px-2 pt-1 text-small text-muted">
            <span lang="zh-Latn-pinyin">{composition.syllables.join(" · ")}</span>
            {composition.toned !== "" && (
              <>
                {" ("}
                <Pinyin reading={composition.toned} features={features} className={null} />
                {")"}
              </>
            )}
          </p>
          {expanded ? (
            <div className="flex items-start gap-1">
              <div
                id={ids.listbox}
                role="listbox"
                aria-label={t("ime.candidates")}
                className="flex flex-1 flex-wrap gap-1"
              >
                {shown
                  .slice(firstShown, firstShown + CANDIDATES_PER_PAGE)
                  .map((candidate, offset) => {
                    const index = firstShown + offset;
                    return (
                      // eslint-disable-next-line jsx-a11y-x/click-events-have-key-events, jsx-a11y-x/interactive-supports-focus -- Keys reach the options through the combobox's aria-activedescendant.
                      <div
                        key={index}
                        id={ids.option(index)}
                        role="option"
                        aria-selected={index === typing.active}
                        lang="zh-Hans"
                        onMouseDown={(event) => {
                          event.preventDefault();
                        }}
                        onClick={() => {
                          apply(commit(state, index));
                          input.current?.focus();
                        }}
                        className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-control px-2.5 font-zh text-subtitle font-normal hover:bg-sunken aria-selected:bg-sunken aria-selected:font-medium aria-selected:inset-ring-2 aria-selected:inset-ring-ink"
                      >
                        {candidate.text}
                      </div>
                    );
                  })}
              </div>
              {shown.length > CANDIDATES_PER_PAGE && (
                <Button
                  variant="ghost"
                  className="w-11 flex-none px-0"
                  aria-label={t("ime.nextCandidates")}
                  onClick={() => {
                    apply(turnPage(state, 1));
                  }}
                >
                  <ChevronRight aria-hidden="true" className="size-5" />
                </Button>
              )}
            </div>
          ) : failure === null ? null : failure.kind === "storage-failure" ? (
            <p role="alert" className="px-2 pb-1 text-danger">
              {t("dataImport.unreadable", { message: failure.message })}
            </p>
          ) : failure.kind === "dataset-missing" ? (
            <p role="alert" className="px-2 pb-1 text-danger">
              {t("dataImport.missing", { dataset: failure.dataset })}
            </p>
          ) : (
            <p className="px-2 pb-1 text-small text-muted">{t("ime.noCandidates")}</p>
          )}
        </div>
      )}
    </div>
  );
};
