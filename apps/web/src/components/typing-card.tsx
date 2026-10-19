import type { Gloss, Grade, LanguagePack, LookupError, Result } from "@openlinguo/core";
import { Check, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { GlossSummary } from "@/components/gloss-summary";
import { ImeField } from "@/components/ime-field";
import { Pinyin } from "@/components/pinyin";
import { PlayAudio } from "@/components/play-audio";
import { RubyWord } from "@/components/ruby-word";
import { Button } from "@/components/ui/button";
import type { AudioSource } from "@/data/audio-packs";
import { gradeTyping, typedReading } from "@/data/typing-card";
import type { Language } from "@/i18n/language";

type Props = {
  readonly headword: string;
  readonly readingKey: string;
  readonly glosses: readonly Gloss[];
  readonly audio: AudioSource | null;
  readonly pack: LanguagePack;
  readonly language: Language;
  readonly focusTarget: RefObject<HTMLDivElement | null>;
  /** Stores the grade; `false` when it could not be stored (the failure is shown by the caller). */
  readonly onGrade: (grade: Grade) => Promise<boolean>;
  readonly onContinue: () => void;
};

type Checked = {
  readonly grade: Grade;
  readonly typed: string;
  readonly reading: Result<string | null, LookupError>;
};

/**
 * Meaning and audio (never played by itself), the word typed through the in-app input method and
 * checked below the card: graded, then what was typed and the answer, each with its pinyin.
 */
export const TypingCard = ({
  headword,
  readingKey,
  glosses,
  audio,
  pack,
  language,
  focusTarget,
  onGrade,
  onContinue,
}: Props) => {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState("");
  const [checked, setChecked] = useState<Checked | null>(null);
  const [busy, setBusy] = useState(false);
  const continueButton = useRef<HTMLButtonElement>(null);
  const ime = pack.features.ime;

  useEffect(() => {
    if (checked !== null) continueButton.current?.focus();
  }, [checked]);

  if (ime === null)
    return (
      <p role="alert" className="mt-6 text-danger">
        {t("review.typingFailed", { reason: "ime" })}
      </p>
    );

  const check = async (): Promise<void> => {
    if (checked !== null || busy) return;
    const typed = answer;
    const grade = gradeTyping(headword, typed);
    setBusy(true);
    const [stored, reading] = await Promise.all([
      onGrade(grade),
      typedReading(pack, { headword, readingKey }, typed),
    ]);
    setBusy(false);
    if (stored) setChecked({ grade, typed, reading });
  };

  const Icon = checked?.grade === "good" ? Check : X;
  const listen = audio === null ? null : <PlayAudio source={audio} align="center" />;

  return (
    <>
      <div className="mt-6 rounded-card border border-hairline bg-surface p-6 text-center">
        <div
          ref={focusTarget}
          tabIndex={-1}
          className="flex flex-col items-center gap-3 rounded-control"
        >
          <p className="self-start text-caption tracking-[0.08em] text-muted uppercase">
            {t("review.typingTitle")}
          </p>
          {checked === null && <p className="text-small text-muted">{t("review.typing")}</p>}
          <GlossSummary
            glosses={glosses}
            language={language}
            className="text-subtitle font-normal"
          />
          {checked === null ? (
            <>
              {listen}
              <div className="mt-1 self-stretch">
                <ImeField
                  label={t("ime.answer")}
                  readOnly={false}
                  ime={ime}
                  features={pack.features}
                  value={answer}
                  onChange={setAnswer}
                  onSubmit={() => void check()}
                />
              </div>
            </>
          ) : (
            <>
              <div role="status" className="flex flex-col items-center gap-2">
                <p className="flex items-center gap-2 font-semibold">
                  <Icon aria-hidden="true" className="size-5 flex-none" />
                  {t("review.toneGraded", { grade: t(`review.grades.${checked.grade}`) })}
                </p>
                {checked.typed !== "" && (
                  <p className="flex flex-wrap items-baseline justify-center gap-2">
                    <span className="text-muted">{t("review.typingYours")}</span>{" "}
                    <span lang="zh-Hans" className="font-zh text-subtitle font-normal">
                      {checked.typed}
                    </span>{" "}
                    {checked.reading.ok && checked.reading.value !== null && (
                      <Pinyin
                        reading={checked.reading.value}
                        features={pack.features}
                        className={null}
                      />
                    )}
                  </p>
                )}
              </div>
              {!checked.reading.ok && (
                <p role="alert" className="text-danger">
                  {checked.reading.error.kind === "dataset-missing"
                    ? t("dataImport.missing", { dataset: checked.reading.error.dataset })
                    : t("dataImport.unreadable", { message: checked.reading.error.message })}
                </p>
              )}
              <div className="flex flex-col items-center gap-2 self-stretch border-t border-hairline pt-3">
                <p className="text-small text-muted">{t("review.typingAnswer")}</p>
                <RubyWord
                  word={headword}
                  reading={readingKey}
                  features={pack.features}
                  size="display"
                />
                {listen}
              </div>
              <Button ref={continueButton} className="w-full" onClick={onContinue}>
                {t("review.toneContinue")}
              </Button>
            </>
          )}
        </div>
      </div>
      {checked === null && (
        <Button className="mt-6 w-full" aria-disabled={busy} onClick={() => void check()}>
          {t("review.toneCheck")}
        </Button>
      )}
    </>
  );
};
