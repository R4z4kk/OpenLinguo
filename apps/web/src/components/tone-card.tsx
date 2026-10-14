import { gradeTones, type Gloss, type Grade, type ToneGrading } from "@openlinguo/core";
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { GlossSummary } from "@/components/gloss-summary";
import { Pinyin, type PinyinFeatures } from "@/components/pinyin";
import { PlayAudio } from "@/components/play-audio";
import { SegmentedControl } from "@/components/segmented-control";
import { Button } from "@/components/ui/button";
import type { AudioSource } from "@/data/audio-packs";
import { spokenReading, toneLabel, toneSyllables } from "@/data/tone-card";
import type { Language } from "@/i18n/language";

const TONES = [1, 2, 3, 4, 5] as const;
const PINYIN = "zh-Latn-pinyin";

type Props = {
  readonly headword: string;
  readonly readingKey: string;
  readonly glosses: readonly Gloss[];
  readonly audio: AudioSource | null;
  readonly features: PinyinFeatures;
  readonly language: Language;
  readonly focusTarget: RefObject<HTMLDivElement | null>;
  /**
   * Stores the grade; `false` when it could not be stored (the failure is shown by the caller).
   * `null` for practice on the word page: nothing graded, the word itself left to the page.
   */
  readonly onGrade: ((grade: Grade) => Promise<boolean>) | null;
  readonly onContinue: () => void;
};

/**
 * Hear a word, pick the tone of each syllable. Graded when checked; the answer and the spoken form
 * after sandhi are shown as text. Keys 1–5 work while focus is in the card (WCAG 2.1.4).
 */
export const ToneCard = ({
  headword,
  readingKey,
  glosses,
  audio,
  features,
  language,
  focusTarget,
  onGrade,
  onContinue,
}: Props) => {
  const { t } = useTranslation();
  const syllables = toneSyllables(readingKey);
  const spoken = spokenReading(headword, readingKey);
  const [picks, setPicks] = useState<readonly number[]>(() => (syllables ?? []).map(() => 0));
  const [result, setResult] = useState<ToneGrading | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const checkButton = useRef<HTMLButtonElement>(null);
  const continueButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (result !== null) continueButton.current?.focus();
  }, [result]);

  if (syllables === null || spoken === null) {
    return (
      <p role="alert" className="text-danger">
        {t("review.toneFailed", { reason: readingKey })}
      </p>
    );
  }

  const label = (tone: number): string => toneLabel(tone, t("review.toneNeutral"));
  const characters = Array.from(headword);
  const incomplete = picks.some((pick) => pick === 0);

  const check = async (): Promise<void> => {
    if (result !== null || busy || incomplete) return;
    const graded = gradeTones(
      syllables.map(({ tone }) => tone),
      spoken.tones,
      picks,
    );
    if (!graded.ok) {
      setFailure(t("review.toneFailed", { reason: graded.error.kind }));
      return;
    }
    if (onGrade === null) {
      setResult(graded.value);
      return;
    }
    setBusy(true);
    const stored = await onGrade(graded.value.grade);
    setBusy(false);
    if (stored) setResult(graded.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || result !== null) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (event.key === "Enter" && target?.tagName !== "BUTTON") {
      event.preventDefault();
      void check();
      return;
    }
    const tone = TONES.find((value) => String(value) === event.key) ?? null;
    if (tone === null) return;
    const group = target?.closest<HTMLElement>("[data-syllable]") ?? null;
    const index = group === null ? picks.indexOf(0) : Number(group.dataset["syllable"]);
    if (!Number.isInteger(index) || index < 0 || index >= picks.length) return;
    event.preventDefault();
    setPicks(picks.map((pick, at) => (at === index ? tone : pick)));
    const next =
      focusTarget.current?.querySelectorAll<HTMLElement>("[data-syllable]")[index + 1] ?? null;
    if (next === null) checkButton.current?.focus();
    else next.querySelector<HTMLElement>("input:checked, input")?.focus();
  };

  return (
    // eslint-disable-next-line jsx-a11y-x/no-static-element-interactions -- Keys bubble from the radios and buttons, so they only work while focus is in the card (WCAG 2.1.4).
    <div
      ref={focusTarget}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex flex-col items-center gap-4 rounded-control"
    >
      <p className="text-small text-muted">{t("review.tone")}</p>
      {onGrade !== null && (
        <>
          <p lang="zh-Hans" className="font-display text-display">
            {headword}
          </p>
          <GlossSummary
            glosses={glosses}
            language={language}
            className="text-subtitle font-normal"
          />
        </>
      )}
      {audio !== null && <PlayAudio source={audio} align="center" />}
      <div className="flex flex-wrap justify-center gap-4">
        {syllables.map(({ letters }, index) => (
          // Syllables never move: the index is a stable key.
          <div key={index} data-syllable={index}>
            <SegmentedControl
              legend={
                <>
                  {characters.length === syllables.length && (
                    <>
                      <span lang="zh-Hans">{characters[index]}</span>{" "}
                    </>
                  )}
                  <span lang={PINYIN}>{letters}</span>
                </>
              }
              name={`tone-${String(index)}`}
              options={TONES.map((tone) => ({
                value: tone,
                label: label(tone),
                lang: tone === 5 ? null : PINYIN,
              }))}
              value={picks[index] ?? 0}
              onChange={(tone) => {
                if (result === null)
                  setPicks(picks.map((pick, at) => (at === index ? tone : pick)));
              }}
              failure={null}
            />
          </div>
        ))}
      </div>
      {result === null ? (
        <>
          <Button
            ref={checkButton}
            className="w-full"
            aria-disabled={incomplete || busy}
            onClick={() => void check()}
          >
            {t("review.toneCheck")}
          </Button>
          {incomplete && <p className="text-small text-muted">{t("review.tonePick")}</p>}
        </>
      ) : (
        <div className="flex w-full flex-col items-center gap-3">
          <div role="status" className="flex flex-col items-center gap-2">
            {onGrade !== null && (
              <p className="font-semibold">
                {t("review.toneGraded", { grade: t(`review.grades.${result.grade}`) })}
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {syllables.map(({ letters, tone }, index) => {
                const said = spoken.tones[index] ?? tone;
                const right = result.correct[index] === true;
                return (
                  <li key={index}>
                    <span lang={PINYIN}>{letters}</span>{" "}
                    {right
                      ? t("review.toneRight", { tone: label(tone) })
                      : t("review.toneWrong", { tone: label(tone) })}
                    {said !== tone && <>, {t("review.toneSpoken", { tone: label(said) })}</>}
                    {!right && <>, {t("review.toneYours", { tone: label(picks[index] ?? 0) })}</>}
                  </li>
                );
              })}
            </ul>
            <p>
              <Pinyin reading={readingKey} features={features} className="text-subtitle" />
            </p>
            {spoken.reading !== readingKey && (
              <p>
                {t("review.toneSaid")}{" "}
                <Pinyin reading={spoken.reading} features={features} className="text-subtitle" />
              </p>
            )}
          </div>
          <Button ref={continueButton} className="w-full" onClick={onContinue}>
            {t("review.toneContinue")}
          </Button>
        </div>
      )}
      {failure !== null && (
        <p role="alert" className="text-danger">
          {failure}
        </p>
      )}
    </div>
  );
};
