import type { LanguagePack, Result } from "@openlinguo/core";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { CorrectionView, useCorrection } from "@/components/correction";
import { GlossSummary } from "@/components/gloss-summary";
import { ImeField } from "@/components/ime-field";
import { Pinyin } from "@/components/pinyin";
import { PlayAudio } from "@/components/play-audio";
import { SegmentedControl } from "@/components/segmented-control";
import { Button } from "@/components/ui/button";
import { loadAiConnection, type AiConnection } from "@/data/ai-settings";
import { CHALLENGE_APP_IME, saveChallenge, type Challenge } from "@/data/challenge";
import { currentCorrections, isCorrected, type Corrections } from "@/data/correction";
import { currentSetting, saveSetting } from "@/data/daily-goal";
import { database } from "@/data/database";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";
import type { Language } from "@/i18n/language";

const storage = (): Storage => localStorage;

type InputMethod = "app" | "device";

type Props = {
  readonly challenge: Challenge;
  readonly pack: LanguagePack;
  readonly language: Language;
  /** Above the title: the session's step, or the challenge's day. */
  readonly eyebrow: string;
  /** `h2` under the session's title, `h1` on its own page. */
  readonly level: "h1" | "h2";
  /** Takes focus when the step appears. */
  readonly focusTarget: RefObject<HTMLDivElement | null> | null;
  /** Ends the Today session's last step; `null`: a saved challenge opened again. */
  readonly onDone: (() => void) | null;
};

const Word = ({ challenge, pack, language }: Pick<Props, "challenge" | "pack" | "language">) => {
  const { t } = useTranslation();
  const { headword, entry, audio } = challenge.word;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 rounded-card border border-hairline bg-surface px-4 py-3">
      <span lang="zh-Hans" className="font-display text-title font-normal">
        {headword}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        {entry === null ? (
          <p className="text-small text-muted">{t("challenge.noEntry")}</p>
        ) : (
          <>
            {entry.reading !== null && (
              <Pinyin reading={entry.reading} features={pack.features} className="text-pinyin" />
            )}
            <GlossSummary glosses={entry.glosses} language={language} className="text-muted" />
          </>
        )}
      </div>
      {audio !== null && (
        <div className="ms-auto">
          <PlayAudio source={audio} align="start" />
        </div>
      )}
    </div>
  );
};

/**
 * Five fields through the in-app input method or the device keyboard, kept on « Save » or « Skip »;
 * once a provider is set, « Correct » and the correction of each sentence.
 */
export const ChallengeForm = ({
  challenge,
  pack,
  language,
  eyebrow,
  level,
  focusTarget,
  onDone,
}: Props) => {
  const { t } = useTranslation();
  const id = useId();
  const ime = pack.features.ime;
  const prompts = pack.prompts;
  const [sentences, setSentences] = useState(challenge.sentences);
  const [corrections, setCorrections] = useState<Corrections>(challenge.corrections);
  const [reviewing, setReviewing] = useState(() =>
    isCorrected(challenge.sentences, challenge.corrections),
  );
  const [method, setMethod] = useState<InputMethod>(() =>
    currentSetting(storage, CHALLENGE_APP_IME) ? "app" : "device",
  );
  const [methodFailure, setMethodFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Result<boolean, ReviewLogFailure> | null>(null);
  const [connection, setConnection] = useState<Result<
    AiConnection | null,
    ReviewLogFailure
  > | null>(null);

  useEffect(() => {
    let current = true;
    void loadAiConnection(database).then((result) => {
      if (current) setConnection(result);
    });
    return () => {
      current = false;
    };
  }, []);

  const store = (next: Corrections): Promise<Result<boolean, ReviewLogFailure>> =>
    saveChallenge(database, { ...challenge, sentences, corrections: next }, Date.now());

  /** `then`: what follows a successful save. */
  const keep = async (then: (() => void) | null): Promise<void> => {
    if (busy) return;
    setBusy(true);
    const result = await store(corrections);
    setBusy(false);
    setSaved(result);
    if (result.ok) then?.();
  };

  const inSession = onDone !== null;
  const skip = (
    <Button variant="ghost" aria-disabled={busy} onClick={() => void keep(onDone)}>
      {t("challenge.skip")}
    </Button>
  );
  const save = (
    <Button
      variant={inSession ? "default" : "outline"}
      aria-disabled={busy}
      onClick={() => void keep(onDone)}
    >
      {t("challenge.save")}
    </Button>
  );
  const correction = useCorrection({
    feature: "challenge",
    source:
      connection?.ok === true && connection.value !== null && prompts !== null
        ? { connection: connection.value, task: prompts.correction }
        : null,
    word: challenge.word.headword,
    sentences,
    language,
    secondary: inSession ? skip : save,
    onCorrected: (next) => {
      void store(next).then((stored) => {
        setSaved(stored);
        if (!stored.ok) return;
        setCorrections(next);
        setReviewing(true);
      });
    },
    onLater: () => void keep(onDone),
  });

  const write = (index: number, value: string): void => {
    setSaved(null);
    setSentences((current) => current.map((sentence, at) => (at === index ? value : sentence)));
  };

  const Heading = level;
  const header = (
    <div ref={focusTarget} tabIndex={-1} className="rounded-control">
      <p className="text-small text-muted">{eyebrow}</p>
      <Heading id={`${id}-title`} className={level === "h1" ? "text-title" : "text-subtitle"}>
        {t(reviewing ? "correction.title" : "challenge.title")}
      </Heading>
    </div>
  );
  const failure = saved?.ok === false && (
    <p role="alert" className="mt-2 text-danger">
      {t("challenge.saveFailed", { reason: describeFailure(saved.error) })}
    </p>
  );

  if (reviewing && prompts !== null)
    return (
      <section aria-labelledby={`${id}-title`}>
        {header}
        <Word challenge={challenge} pack={pack} language={language} />
        {correction.warning}
        <CorrectionView
          heading={level === "h1" ? "h2" : "h3"}
          corrections={currentCorrections(sentences, corrections)}
          prompts={prompts}
          features={pack.features}
          onChoose={async (index, choice) => {
            const next = corrections.map((item, at) =>
              at === index && item !== null ? { ...item, choice } : item,
            );
            const stored = await store(next);
            if (!stored.ok) return stored;
            setCorrections(next);
            return { ok: true, value: null };
          }}
        />
        {onDone !== null && (
          <Button variant="outline" className="mt-6" onClick={onDone}>
            {t("challenge.finish")}
          </Button>
        )}
        {failure}
      </section>
    );

  const appIme = method === "app" ? ime : null;
  return (
    <section aria-labelledby={`${id}-title`}>
      {header}
      <Word challenge={challenge} pack={pack} language={language} />
      {inSession && <p className="mt-4 text-muted">{t("challenge.intro")}</p>}
      {ime !== null && (
        <div className="mt-4">
          <SegmentedControl
            legend={t("challenge.inputMethod")}
            name={`${id}-method`}
            options={[
              { value: "app", label: t("challenge.appIme"), lang: null },
              { value: "device", label: t("challenge.deviceKeyboard"), lang: null },
            ]}
            value={method}
            onChange={(next) => {
              setMethod(next);
              const stored = saveSetting(storage, CHALLENGE_APP_IME, next === "app");
              setMethodFailure(
                stored.ok ? null : t("challenge.imeNotSaved", { reason: stored.error }),
              );
            }}
            failure={methodFailure}
          />
        </div>
      )}
      <div className="mt-4 flex flex-col gap-3">
        {sentences.map((sentence, index) => {
          const label = t("challenge.sentence", { number: index + 1 });
          const field = `${id}-sentence-${String(index)}`;
          return appIme !== null ? (
            <ImeField
              // Fields never move: the index is a stable key.
              key={index}
              label={label}
              ime={appIme}
              features={pack.features}
              value={sentence}
              readOnly={correction.running}
              onChange={(value) => {
                write(index, value);
              }}
              onSubmit={null}
            />
          ) : (
            <div key={index} className="flex flex-col gap-2">
              <label htmlFor={field} className="font-semibold">
                {label}
              </label>
              <input
                id={field}
                type="text"
                lang="zh-Hans"
                value={sentence}
                readOnly={correction.running}
                onChange={(event) => {
                  write(index, event.target.value);
                }}
                className="min-h-13 w-full rounded-control border border-border-strong bg-surface px-3 font-zh text-pinyin read-only:bg-sunken"
              />
            </div>
          );
        })}
      </div>
      {correction.controls ?? (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {save}
            {inSession && skip}
          </div>
          {connection?.ok === true && connection.value === null && (
            <p className="mt-2 text-small text-muted">
              {t("challenge.providerBefore")}
              <Link to="/profile" hash="ai" className="underline">
                {t("challenge.providerLink")}
              </Link>
              {t("challenge.providerAfter")}
            </p>
          )}
        </>
      )}
      {connection?.ok === false && (
        <p role="alert" className="mt-2 text-danger">
          {t("ai.loadFailed", { reason: describeFailure(connection.error) })}
        </p>
      )}
      <p role="status" className="mt-2 text-small">
        {saved?.ok === true && !inSession && t("challenge.saved")}
      </p>
      {failure}
      {correction.warning}
      <p className="mt-4 text-small text-muted">{t("challenge.footnote")}</p>
    </section>
  );
};
