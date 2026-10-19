import {
  AI_PROVIDERS,
  type AiError,
  type AiErrorKind,
  type AiProvider,
  type CorrectionAnswer,
  type CorrectionInput,
  type PromptTask,
  type Result,
} from "@openlinguo/core";
import { Check, CircleAlert, ExternalLink, Info, Send, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/switch";
import { Button } from "@/components/ui/button";
import {
  aiEndpoint,
  keyFor,
  loadAiSettings,
  PROVIDER_LINKS,
  saveAiSettings,
  TEST_SENTENCE,
  testConnection,
  TRAINING_OPT_OUT,
  type AiSettings,
} from "@/data/ai-settings";
import { database } from "@/data/database";
import { describeFailure, type ReviewLogFailure } from "@/data/review-log";
import { DEFAULT_LANGUAGE, languages } from "@/i18n/language";
import { cn } from "@/lib/utils";

type Correction = PromptTask<CorrectionInput, CorrectionAnswer>;

/** An aborted test is the learner's doing: nothing to show. */
type ShownError = Omit<AiError, "kind"> & { readonly kind: Exclude<AiErrorKind, "aborted"> };

type Outcome =
  | { readonly kind: "listed"; readonly count: number }
  | { readonly kind: "connected"; readonly model: string }
  | { readonly kind: "forgotten" }
  | { readonly kind: "failed"; readonly error: ShownError };

const fieldClass =
  "min-h-12 w-full rounded-control border border-border-strong bg-surface px-3 aria-invalid:border-danger";

const NewTabLink = ({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) => {
  const { t } = useTranslation();
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-6 items-center gap-1 underline underline-offset-3"
    >
      {children}
      <ExternalLink aria-hidden="true" className="size-3.5 flex-none" />
      <span className="sr-only"> {t("ai.newTab")}</span>
    </a>
  );
};

const Failure = ({
  provider,
  error,
}: {
  readonly provider: AiProvider;
  readonly error: ShownError;
}) => {
  const { t } = useTranslation();
  const name = t(`aiNotice.providers.${provider}`);
  const local = provider === "local" && error.kind === "network";
  return (
    <div
      role="alert"
      className="mt-4 flex items-start gap-2 rounded-card border-2 border-danger bg-surface px-4 py-3"
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-5 flex-none text-danger" />
      <div className="flex min-w-0 flex-col gap-1">
        <strong>
          {local ? t("ai.errors.localNetwork") : t(`ai.errors.${error.kind}`, { provider: name })}
        </strong>
        {local && <span>{t("ai.errors.localNetworkHelp", { origin: location.origin })}</span>}
        {error.message !== null && (
          <span className="text-small break-words text-muted">{error.message}</span>
        )}
      </div>
    </div>
  );
};

/** Profile › AI assistant: the provider, its key and model, and the connection test (ADR 0012). */
export const AiSettingsSection = ({ correction }: { readonly correction: Correction }) => {
  const { t } = useTranslation();
  const [loaded, setLoaded] = useState<Result<AiSettings, ReviewLogFailure> | null>(null);

  useEffect(() => {
    let current = true;
    void loadAiSettings(database).then((result) => {
      if (current) setLoaded(result);
    });
    return () => {
      current = false;
    };
  }, []);

  return (
    <section aria-labelledby="ai">
      <h2 id="ai" className="mt-8 text-subtitle">
        {t("ai.title")}
      </h2>
      <p className="mt-2 text-muted">{t("ai.intro")}</p>
      {loaded !== null && !loaded.ok && (
        <p role="alert" className="mt-4 text-danger">
          {t("ai.loadFailed", { reason: describeFailure(loaded.error) })}
        </p>
      )}
      {loaded?.ok === true && <AiSettingsForm initial={loaded.value} correction={correction} />}
    </section>
  );
};

const AiSettingsForm = ({
  initial,
  correction,
}: {
  readonly initial: AiSettings;
  readonly correction: Correction;
}) => {
  const { t, i18n } = useTranslation();
  const [settings, setSettings] = useState(initial);
  const [choosing, setChoosing] = useState(initial.provider === null);
  const [models, setModels] = useState<readonly string[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [fieldError, setFieldError] = useState<"key" | "address" | null>(null);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const [howToOpen] = useState(initial.model?.provider !== "local");
  const latest = useRef(initial);
  const running = useRef<AbortController | null>(null);
  const group = useRef<HTMLFieldSetElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const modelSelect = useRef<HTMLSelectElement>(null);
  const reopened = useRef(false);
  const focusModel = useRef(false);
  const id = useId();
  const language = languages.find((code) => code === i18n.language) ?? DEFAULT_LANGUAGE;

  useEffect(() => () => running.current?.abort(), []);

  useEffect(() => {
    if (reopened.current) {
      reopened.current = false;
      group.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    }
    if (focusModel.current) {
      focusModel.current = false;
      modelSelect.current?.focus();
    }
  });

  const update = (next: AiSettings): void => {
    latest.current = next;
    setSettings(next);
    void saveAiSettings(database, next).then((saved) => {
      setSaveFailure(saved.ok ? null : describeFailure(saved.error));
    });
  };

  const stopTest = (): void => {
    running.current?.abort();
    running.current = null;
    setTesting(false);
  };

  const choose = (provider: AiProvider): void => {
    stopTest();
    setModels(null);
    setOutcome(null);
    setFieldError(null);
    update({ ...latest.current, provider });
    // A click that did not focus the radio (Safari) ends the choice; arrows keep the list open.
    if (group.current?.contains(document.activeElement) !== true) setChoosing(false);
  };

  const runTest = async (): Promise<void> => {
    if (running.current !== null) return;
    const endpoint = aiEndpoint(latest.current);
    if (endpoint === null) {
      const field = latest.current.provider === "local" ? "address" : "key";
      setFieldError(field);
      (field === "address" ? addressInput : keyInput).current?.focus();
      return;
    }
    const controller = new AbortController();
    running.current = controller;
    setTesting(true);
    setOutcome(null);
    const chosen = latest.current.model;
    const result = await testConnection(
      endpoint,
      chosen?.provider === endpoint.provider ? chosen : null,
      correction,
      language,
      controller.signal,
    );
    if (running.current !== controller) return;
    running.current = null;
    setTesting(false);
    if (result.models !== null) setModels(result.models);
    if (!result.answer.ok) {
      const { error } = result.answer;
      const { kind } = error;
      if (kind !== "aborted") setOutcome({ kind: "failed", error: { ...error, kind } });
      return;
    }
    const answered = result.answer.value;
    if (answered === null) {
      setOutcome({ kind: "listed", count: result.models?.length ?? 0 });
    } else {
      update({ ...latest.current, model: answered });
      setOutcome({ kind: "connected", model: answered.id });
    }
    focusModel.current = true;
  };

  const { provider } = settings;
  const key = provider !== null && settings.key?.provider === provider ? settings.key.value : "";
  const model = provider !== null && settings.model?.provider === provider ? settings.model : null;
  const listedModel = models?.includes(model?.id ?? "") === true ? (model?.id ?? "") : "";

  return (
    <>
      {choosing || provider === null ? (
        <fieldset ref={group} className="mt-6 flex min-w-0 flex-col gap-2">
          <legend className="font-semibold">{t("ai.provider")}</legend>
          <p className="text-small text-muted">{t("ai.noDefault")}</p>
          {AI_PROVIDERS.map((option) => (
            <label
              key={option}
              className="group flex cursor-pointer items-start gap-3 rounded-control border border-hairline bg-surface p-3 has-checked:border-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink"
            >
              <input
                type="radio"
                name={`${id}-provider`}
                value={option}
                checked={provider === option}
                aria-labelledby={`${id}-${option}`}
                aria-describedby={`${id}-${option}-summary`}
                onChange={() => {
                  choose(option);
                }}
                onBlur={(event) => {
                  if (provider !== null && group.current?.contains(event.relatedTarget) !== true) {
                    setChoosing(false);
                  }
                }}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-5 flex-none items-center justify-center rounded-full border-2 border-border-strong bg-surface group-has-checked:border-ink"
              >
                <span className="hidden size-2.5 rounded-full bg-ink group-has-checked:block" />
              </span>
              <span className="flex flex-col">
                <span id={`${id}-${option}`} className="font-semibold">
                  {t(`ai.providers.${option}.name`)}
                </span>
                <span id={`${id}-${option}-summary`} className="text-small text-muted">
                  {t(`ai.providers.${option}.summary`)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-card border border-hairline bg-surface py-2 ps-4 pe-2">
          <p>
            <span className="text-muted">{t("ai.chosen")} </span>
            <strong>{t(`ai.providers.${provider}.name`)}</strong>
          </p>
          <Button
            variant="ghost"
            aria-label={t("ai.changeLabel")}
            onClick={() => {
              reopened.current = true;
              setChoosing(true);
            }}
          >
            {t("ai.change")}
          </Button>
        </div>
      )}
      {saveFailure !== null && (
        <p role="alert" className="mt-2 text-danger">
          {t("ai.notSaved", { reason: saveFailure })}
        </p>
      )}
      {provider === null ? (
        <p className="mt-4 text-small text-muted">{t("ai.withoutProvider")}</p>
      ) : (
        <>
          <div
            role="note"
            aria-label={t(`ai.providers.${provider}.about`)}
            className="mt-4 flex gap-2.5 rounded-card border border-border-strong bg-sunken px-4 py-3"
          >
            <Info aria-hidden="true" className="mt-0.5 size-5 flex-none" />
            <div className="flex min-w-0 flex-col gap-1.5">
              {provider !== "local" && (
                <p>{t("ai.notice", { provider: t(`ai.providers.${provider}.name`) })}</p>
              )}
              <p>{t(`ai.providers.${provider}.data`)}</p>
              {provider !== "local" && (
                <p>
                  <NewTabLink href={PROVIDER_LINKS[provider].privacy}>
                    {t(`ai.providers.${provider}.privacy`)}
                  </NewTabLink>
                </p>
              )}
              {(provider === "openrouter" || provider === "mistral") && (
                <p>
                  <NewTabLink href={TRAINING_OPT_OUT[provider]}>
                    {t(`ai.providers.${provider}.training`)}
                  </NewTabLink>
                </p>
              )}
            </div>
          </div>
          {provider === "local" ? (
            <>
              <div className="mt-4 flex flex-col gap-2">
                <label htmlFor={`${id}-address`} className="font-semibold">
                  {t("ai.address")}
                </label>
                <input
                  ref={addressInput}
                  id={`${id}-address`}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={settings.localAddress}
                  aria-invalid={fieldError === "address"}
                  aria-describedby={`${id}-address-help${fieldError === "address" ? ` ${id}-address-error` : ""}`}
                  onChange={(event) => {
                    setFieldError(null);
                    setModels(null);
                    update({ ...latest.current, localAddress: event.target.value });
                  }}
                  className={fieldClass}
                />
                <p id={`${id}-address-help`} className="text-small text-muted">
                  {t("ai.addressHelp")}
                </p>
                {fieldError === "address" && (
                  <p id={`${id}-address-error`} className="text-small text-danger">
                    {t("ai.addressInvalid")}
                  </p>
                )}
              </div>
              <details
                open={howToOpen}
                className="mt-4 rounded-card border border-hairline bg-surface px-4 pb-4"
              >
                <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
                  {t("ai.howTo")}
                </summary>
                <p>{t("ai.howToStart")}</p>
                <pre className="mt-2 rounded-control bg-sunken p-3 font-mono text-small break-all whitespace-pre-wrap">
                  OLLAMA_ORIGINS={location.origin} ollama serve
                </pre>
                <p className="mt-2 text-small text-muted">{t("ai.howToBrowsers")}</p>
              </details>
            </>
          ) : (
            <>
              <div className="mt-4 flex flex-col gap-2">
                <label htmlFor={`${id}-key`} className="font-semibold">
                  {t("ai.key")}
                </label>
                <input
                  ref={keyInput}
                  id={`${id}-key`}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  aria-invalid={fieldError === "key"}
                  aria-describedby={`${id}-key-help`}
                  onChange={(event) => {
                    setFieldError(null);
                    update({ ...latest.current, key: keyFor(provider, event.target.value) });
                  }}
                  className={fieldClass}
                />
                <p id={`${id}-key-help`} className="text-small text-muted">
                  {t("ai.keyHelp")}{" "}
                  <NewTabLink href={PROVIDER_LINKS[provider].keys}>
                    {t(`ai.providers.${provider}.console`)}
                  </NewTabLink>
                  .
                </p>
              </div>
              <div className="mt-4">
                <Switch
                  label={t("ai.dontRemember")}
                  hint={t("ai.dontRememberHint")}
                  checked={!settings.rememberKey}
                  onChange={(dontRemember) => {
                    update({ ...latest.current, rememberKey: !dontRemember });
                  }}
                />
              </div>
            </>
          )}
          <div role="status">
            {outcome !== null && outcome.kind !== "failed" && (
              <p className="mt-4 flex items-start gap-2 rounded-card border border-hairline bg-surface px-4 py-3">
                <Check aria-hidden="true" className="mt-0.5 size-5 flex-none" />
                <span>
                  {outcome.kind === "listed" &&
                    t("ai.listed", {
                      count: outcome.count,
                      provider: t(`aiNotice.providers.${provider}`),
                    })}
                  {outcome.kind === "connected" && t("ai.connected", { model: outcome.model })}
                  {outcome.kind === "forgotten" && t("ai.forgotten")}
                </span>
              </p>
            )}
          </div>
          {outcome?.kind === "failed" && <Failure provider={provider} error={outcome.error} />}
          <div className="mt-4 flex flex-col gap-2">
            <label htmlFor={`${id}-model`} className="font-semibold">
              {t("ai.model")}
            </label>
            <select
              ref={modelSelect}
              id={`${id}-model`}
              disabled={models === null}
              value={models === null ? (model?.id ?? "") : listedModel}
              {...(models === null ? {} : { "aria-describedby": `${id}-model-help` })}
              onChange={(event) => {
                const chosen = event.target.value;
                if (chosen === "") return;
                const current = latest.current.model;
                setOutcome(null);
                update({
                  ...latest.current,
                  model:
                    current?.provider === provider && current.id === chosen
                      ? current
                      : { provider, id: chosen, mode: "json_schema" },
                });
              }}
              className={cn(fieldClass, "disabled:bg-sunken disabled:text-muted")}
            >
              {models === null ? (
                <option value={model?.id ?? ""}>{model?.id ?? t("ai.modelUntested")}</option>
              ) : (
                <>
                  {listedModel === "" && <option value="">{t("ai.modelChoose")}</option>}
                  {models.map((listed) => (
                    <option key={listed} value={listed}>
                      {listed}
                    </option>
                  ))}
                </>
              )}
            </select>
            {models !== null && (
              <p id={`${id}-model-help`} className="text-small text-muted">
                {t(`ai.providers.${provider}.models`)}
              </p>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              aria-disabled={testing}
              aria-describedby={`${id}-sent`}
              onClick={() => void runTest()}
            >
              {t(testing ? "ai.testing" : "ai.test")}
            </Button>
            {key !== "" && (
              <Button
                variant="danger"
                onClick={() => {
                  update({ ...latest.current, key: null });
                  setOutcome({ kind: "forgotten" });
                  keyInput.current?.focus();
                }}
              >
                <Trash2 aria-hidden="true" className="size-4.5" />
                {t("ai.forget")}
              </Button>
            )}
          </div>
          <p className="mt-2 text-small text-muted">{t("ai.testHelp")}</p>
          <p id={`${id}-sent`} className="mt-2 flex items-start gap-1.5 text-small text-muted">
            <Send aria-hidden="true" className="mt-0.5 size-4 flex-none" />
            <span>
              {t(provider === "local" ? "ai.sentNoKey" : "ai.sentKey", {
                to: t(`ai.providers.${provider}.sentTo`),
              })}
              <span lang="zh-Hans">{TEST_SENTENCE}</span>
              {t("ai.sentEnd")}
            </span>
          </p>
          {key !== "" && <p className="mt-2 text-small text-muted">{t("ai.forgetHint")}</p>}
        </>
      )}
    </>
  );
};
