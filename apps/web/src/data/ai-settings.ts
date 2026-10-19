import {
  AI_BASE_URLS,
  chat,
  err,
  listModels,
  ok,
  type AiEndpoint,
  type AiError,
  type AiProvider,
  type CorrectionAnswer,
  type CorrectionInput,
  type GlossLanguage,
  type PromptTask,
  type Result,
  type StructuredMode,
} from "@openlinguo/core";
import type { Database } from "./database.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

export const AI_PROVIDERS = [
  "groq",
  "openrouter",
  "mistral",
  "local",
] as const satisfies readonly AiProvider[];

export type CloudProvider = Exclude<AiProvider, "local">;

export type ProviderLinks = {
  readonly privacy: string;
  /** Where the learner creates a key. */
  readonly keys: string;
};

/** The date the links and the provider lines of the catalogs were checked (ADR 0012). */
export const PROVIDER_FACTS_CHECKED_ON = "2026-10-19";

export const PROVIDER_LINKS: Readonly<Record<CloudProvider, ProviderLinks>> = {
  groq: {
    privacy: "https://groq.com/privacy-policy",
    keys: "https://console.groq.com/keys",
  },
  openrouter: {
    privacy: "https://openrouter.ai/privacy",
    keys: "https://openrouter.ai/settings/keys",
  },
  mistral: {
    privacy: "https://legal.mistral.ai/terms/privacy-policy",
    keys: "https://console.mistral.ai/api-keys",
  },
};

/** How to refuse training on prompts, where the provider may train on them. */
export const TRAINING_OPT_OUT: Readonly<Record<"openrouter" | "mistral", string>> = {
  openrouter: "https://openrouter.ai/docs/guides/privacy/data-collection",
  mistral: "https://help.mistral.ai/en/articles/347617",
};

/** A key or a model applies to the provider it was set for only: a key never reaches another one. */
export type AiKey = { readonly provider: AiProvider; readonly value: string };
export type AiModel = {
  readonly provider: AiProvider;
  readonly id: string;
  /** The structured-output mode that worked last with this model. */
  readonly mode: StructuredMode;
};

export type AiSettings = {
  readonly provider: AiProvider | null;
  /** As typed: checked by `localBaseUrl`. */
  readonly localAddress: string;
  readonly rememberKey: boolean;
  readonly key: AiKey | null;
  readonly model: AiModel | null;
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: null,
  localAddress: new URL(AI_BASE_URLS.local).origin,
  rememberKey: true,
  key: null,
  model: null,
};

const SETTINGS_ID = "ai";

/** The key while « Don't remember the key » is on: gone with the page. */
let memoryKey: AiKey | null = null;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** The API base of a server on this device: an `http` origin the page's CSP lets it reach. */
export const localBaseUrl = (address: string): string | null => {
  const url = URL.parse(address.trim());
  const origin =
    url !== null &&
    url.protocol === "http:" &&
    LOCAL_HOSTS.has(url.hostname) &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "";
  return origin ? `${url.origin}/v1` : null;
};

/** The key typed for `provider`: blank is no key. */
export const keyFor = (provider: AiProvider, value: string): AiKey | null => {
  const trimmed = value.trim();
  return trimmed === "" ? null : { provider, value: trimmed };
};

export const loadAiSettings = (db: Database): Promise<Result<AiSettings, ReviewLogFailure>> =>
  guarded(async () => {
    const stored = (await db.aiSettings.get(SETTINGS_ID)) ?? null;
    if (stored === null) return ok({ ...DEFAULT_AI_SETTINGS, key: memoryKey });
    const { provider, localAddress, rememberKey, key, model } = stored;
    return ok({ provider, localAddress, rememberKey, key: rememberKey ? key : memoryKey, model });
  });

/** Writes the key to IndexedDB only while it is remembered, never anywhere else. */
export const saveAiSettings = (
  db: Database,
  settings: AiSettings,
): Promise<Result<null, ReviewLogFailure>> =>
  guarded(async () => {
    memoryKey = settings.rememberKey ? null : settings.key;
    await db.aiSettings.put({
      ...settings,
      id: SETTINGS_ID,
      key: settings.rememberKey ? settings.key : null,
    });
    return ok(null);
  });

/** The chosen provider's endpoint; `null` without its key or with an invalid local address. */
export const aiEndpoint = (settings: AiSettings): AiEndpoint | null => {
  const { provider, key } = settings;
  if (provider === null) return null;
  if (provider === "local") {
    const baseUrl = localBaseUrl(settings.localAddress);
    return baseUrl === null ? null : { provider, baseUrl, key: null };
  }
  return key?.provider === provider
    ? { provider, baseUrl: AI_BASE_URLS[provider], key: key.value }
    : null;
};

/** What an AI feature calls the client with. */
export type AiConnection = {
  readonly endpoint: AiEndpoint;
  readonly model: string;
  readonly mode: StructuredMode;
};

/** `null` until a provider, its key and a model are set: the AI features stay hidden. */
export const aiConnection = (settings: AiSettings): AiConnection | null => {
  const endpoint = aiEndpoint(settings);
  const { model } = settings;
  return endpoint === null || model?.provider !== endpoint.provider
    ? null
    : { endpoint, model: model.id, mode: model.mode };
};

export const loadAiConnection = async (
  db: Database,
): Promise<Result<AiConnection | null, ReviewLogFailure>> => {
  const settings = await loadAiSettings(db);
  return settings.ok ? ok(aiConnection(settings.value)) : settings;
};

/** The sentence the connection test sends, corrected with the real correction prompt. */
export const TEST_SENTENCE = "我很好。";

export type ConnectionTest = {
  /** The endpoint's models, `null` when they could not be listed. */
  readonly models: readonly string[] | null;
  /** The model that answered in the expected format; `null` while none is chosen. */
  readonly answer: Result<AiModel | null, AiError>;
};

/** Lists the models, then, once one is chosen, sends the test sentence for correction. */
export const testConnection = async (
  endpoint: AiEndpoint,
  model: AiModel | null,
  correction: PromptTask<CorrectionInput, CorrectionAnswer>,
  language: GlossLanguage,
  signal: AbortSignal,
): Promise<ConnectionTest> => {
  const listed = await listModels(endpoint, signal);
  if (!listed.ok) return { models: null, answer: listed };
  const models = listed.value;
  if (model?.provider !== endpoint.provider) return { models, answer: ok(null) };
  if (!models.includes(model.id)) {
    return { models, answer: err({ kind: "model-not-found", status: null, message: null }) };
  }
  const input: CorrectionInput = { word: null, sentences: [TEST_SENTENCE], language };
  const answer = await chat({
    endpoint,
    model: model.id,
    messages: correction.messages(input),
    schema: correction.schema(input),
    mode: model.mode,
    signal,
  });
  return {
    models,
    answer: answer.ok ? ok({ ...model, mode: answer.value.mode }) : answer,
  };
};
