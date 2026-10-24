import {
  chat,
  ok,
  proficiencyFrameworks,
  type AiProvenance,
  type LanguageId,
  type PromptTask,
  type Result,
  type StoryAnswer,
  type StoryInput,
  type StoryLength,
} from "@openlinguo/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAiNotice } from "@/components/ai-notice";
import { AiSent } from "@/components/ai-sent";
import { SegmentedControl } from "@/components/segmented-control";
import { Button } from "@/components/ui/button";
import type { AiCall } from "@/data/ai-notice";
import { loadAiConnection, rememberMode, type AiConnection } from "@/data/ai-settings";
import { useData } from "@/data/data-context";
import { database } from "@/data/database";
import { deckCounts, localNow } from "@/data/decks";
import { learningBand, loadInterests, THEMES } from "@/data/interests";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";
import { describeRefusal, learningWords, saveStory } from "@/data/story";
import { AiFailure, fieldClass, type ShownError } from "@/shell/ai-settings";

const storage = (): Storage => localStorage;

type Theme = (typeof THEMES)[number];

type Loaded<T> = Result<T, ReviewLogFailure> | null;

type Focus = "cancel" | "generate";

/**
 * Read › Write a story: one press, one call. A valid answer is stored as a text and opened in the
 * reader; an invalid one is an error with « Try again », and nothing is stored.
 */
export const StoryForm = ({
  story,
  language,
}: {
  readonly story: PromptTask<StoryInput, StoryAnswer>;
  readonly language: LanguageId;
}) => {
  const { t } = useTranslation();
  const { referential } = useData();
  const navigate = useNavigate();
  const notice = useAiNotice();
  const id = useId();
  const [interests] = useState(() => loadInterests(storage));
  const [theme, setTheme] = useState<Theme>(
    () => (interests.ok ? interests.value.themes[0] : null) ?? THEMES[0],
  );
  const [length, setLength] = useState<StoryLength>("medium");
  const [connection, setConnection] = useState<Loaded<AiConnection | null>>(null);
  const [band, setBand] = useState<Loaded<number>>(null);
  const [words, setWords] = useState<Loaded<readonly string[]>>(null);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<ShownError | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const leaving = useRef(false);
  const focus = useRef<Focus | null>(null);
  const generateButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    leaving.current = false;
    return () => {
      leaving.current = true;
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    let current = true;
    void Promise.all([
      loadAiConnection(database),
      deckCounts(database, referential, localNow()),
      learningWords(database, language),
    ]).then(([linked, counts, learning]) => {
      if (!current) return;
      setConnection(linked);
      setBand(counts.ok ? ok(learningBand(counts.value.bands)) : counts);
      setWords(learning);
    });
    return () => {
      current = false;
    };
  }, [referential, language]);

  useEffect(() => {
    const target = focus.current;
    if (target === null) return;
    const button = (target === "cancel" ? cancelButton : generateButton).current;
    // An earlier render's effect may run late: the request waits for its button to be drawn.
    if (button === null) return;
    focus.current = null;
    button.focus();
  });

  const write = async (to: AiConnection, input: StoryInput): Promise<void> => {
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setFailure(null);
    setProblem(null);
    focus.current = "cancel";
    const answer = await chat({
      endpoint: to.endpoint,
      model: to.model,
      messages: story.messages(input),
      schema: story.schema(input),
      mode: to.mode,
      signal: abort.signal,
    });
    if (controller.current !== abort) return;
    controller.current = null;
    if (!answer.ok) {
      setRunning(false);
      const { error } = answer;
      const { kind } = error;
      if (kind !== "aborted") setFailure({ ...error, kind });
      focus.current = "generate";
      return;
    }
    const createdAt = new Date().toISOString();
    const provenance: AiProvenance = {
      origin: "ai",
      provider: to.endpoint.provider,
      model: to.model,
      promptVersion: story.id,
      createdAt,
    };
    // Best effort: the remembered mode only saves a fallback request next time.
    await rememberMode(database, to, answer.value.mode);
    const saved = await saveStory(
      database,
      answer.value.value,
      provenance,
      Date.parse(createdAt),
      crypto.randomUUID(),
    );
    if (saved.ok) {
      if (!leaving.current) void navigate({ to: "/read/$id", params: { id: saved.value.id } });
      return;
    }
    setRunning(false);
    switch (saved.error.kind) {
      case "empty":
      case "too-long":
      case "title-too-long":
        setFailure({
          kind: "invalid-response",
          status: null,
          message: describeRefusal(saved.error),
        });
        break;
      default:
        setProblem(t("story.saveFailed", { reason: describeFailure(saved.error) }));
    }
    focus.current = "generate";
  };

  const link = connection?.ok === true ? connection.value : null;
  const level = band?.ok === true ? band.value : null;
  const learning = words?.ok === true ? words.value : null;
  const unreadable = band?.ok === false ? band.error : words?.ok === false ? words.error : null;
  const bandName =
    level === null
      ? ""
      : t("dictionary.level", {
          level: proficiencyFrameworks[referential][level - 1] ?? String(level),
        });
  const action = failure === null && problem === null ? t("story.generate") : t("story.retry");
  const input: StoryInput | null =
    level === null || learning === null
      ? null
      : { band: level, theme: t(`interests.theme.${theme}`), length, words: learning };
  const call: AiCall | null =
    link === null || input === null
      ? null
      : {
          provider: link.endpoint.provider,
          action,
          payload: { feature: "story", input, band: bandName },
        };

  return (
    <section aria-labelledby={`${id}-title`} className="max-w-2xl">
      <Link to="/read" className="-mt-3 mb-1 flex min-h-11 w-fit items-center gap-1">
        <ChevronLeft aria-hidden="true" className="size-5" />
        {t("library.back")}
      </Link>
      <h1 id={`${id}-title`} className="text-title">
        {t("story.title")}
      </h1>
      <p className="mt-2 text-muted">{t("story.intro")}</p>
      {connection?.ok === true && link === null && (
        <p className="mt-6 text-muted">
          {t("story.noProvider")}{" "}
          <Link to="/profile" hash="ai" className="underline underline-offset-3">
            {t("story.toSettings")}
          </Link>
        </p>
      )}
      {connection?.ok === false && (
        <p role="alert" className="mt-6 text-danger">
          {t("ai.loadFailed", { reason: describeFailure(connection.error) })}
        </p>
      )}
      {unreadable !== null && (
        <p role="alert" className="mt-6 text-danger">
          {t("story.loadFailed", { reason: describeFailure(unreadable) })}
        </p>
      )}
      {link !== null && input !== null && call !== null && (
        <>
          <div className="mt-6 flex flex-col items-start gap-1">
            <p className="font-semibold">{t("story.level")}</p>
            <span className="rounded-full border border-border-strong px-2 text-caption font-semibold">
              {bandName}
            </span>
            <p className="text-small text-muted">{t("story.levelHelp")}</p>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <label htmlFor={`${id}-theme`} className="font-semibold">
              {t("story.theme")}
            </label>
            <select
              id={`${id}-theme`}
              value={theme}
              onChange={(event) => {
                const next = THEMES.find((candidate) => candidate === event.currentTarget.value);
                if (next != null) setTheme(next);
              }}
              className={fieldClass}
            >
              {THEMES.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {t(`interests.theme.${candidate}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-4">
            <SegmentedControl<StoryLength>
              legend={t("story.length")}
              name={`${id}-length`}
              options={[
                { value: "short", label: t("story.short"), lang: null },
                { value: "medium", label: t("story.medium"), lang: null },
              ]}
              value={length}
              onChange={setLength}
              failure={null}
            />
          </div>
          <section aria-labelledby={`${id}-words`} className="mt-4">
            <h2 id={`${id}-words`} className="font-semibold">
              {t("story.words")}
            </h2>
            {input.words.length === 0 ? (
              <p className="mt-1 text-muted">{t("story.noWords")}</p>
            ) : (
              <>
                <p className="mt-1 text-small text-muted">{t("story.wordsHelp")}</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {input.words.map((word) => (
                    <li
                      key={word}
                      lang="zh-Hans"
                      className="rounded-full border border-border-strong px-3 py-1 font-zh"
                    >
                      {word}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button
              ref={generateButton}
              aria-describedby={`${id}-sent`}
              aria-disabled={running}
              onClick={() => {
                if (!running) notice.ask(call.provider, () => void write(link, input));
              }}
            >
              {action}
            </Button>
            {running && (
              <Button
                ref={cancelButton}
                variant="outline"
                onClick={() => controller.current?.abort()}
              >
                {t("story.cancel")}
              </Button>
            )}
          </div>
          <AiSent id={`${id}-sent`} call={call} />
        </>
      )}
      <p role="status" className="mt-3 text-small">
        {running ? t("story.writing") : ""}
      </p>
      {failure !== null && link !== null && (
        <AiFailure provider={link.endpoint.provider} error={failure} />
      )}
      {problem !== null && (
        <p role="alert" className="mt-4 text-danger">
          {problem}
        </p>
      )}
      {notice.view}
    </section>
  );
};
