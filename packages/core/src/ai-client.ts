import { z } from "zod";
import type { ChatMessage } from "./prompt-pack.ts";
import { err, ok, type Result } from "./result.ts";
import { parseWith, type ValidationError } from "./validation.ts";

export type AiProvider = "groq" | "openrouter" | "mistral" | "local";

/** Checked on 2026-10-19 (ADR 0012); `local` is Ollama's default address. */
export const AI_BASE_URLS: Readonly<Record<AiProvider, string>> = {
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  mistral: "https://api.mistral.ai/v1",
  local: "http://localhost:11434/v1",
};

export type AiEndpoint = {
  readonly provider: AiProvider;
  readonly baseUrl: string;
  readonly key: string | null;
};

export type StructuredMode = "json_schema" | "json_object";

export type AiErrorKind =
  | "network"
  | "auth"
  | "forbidden"
  | "model-not-found"
  | "rate-limited"
  | "quota"
  | "too-large"
  | "server"
  | "timeout"
  | "invalid-response"
  | "aborted";

export type AiError = {
  readonly kind: AiErrorKind;
  readonly status: number | null;
  readonly message: string | null;
};

export type AiChatRequest<T> = {
  readonly endpoint: AiEndpoint;
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly schema: z.ZodType<T>;
  readonly mode: StructuredMode;
  readonly signal: AbortSignal;
};

export type AiAnswer<T> = { readonly value: T; readonly mode: StructuredMode };

// Retry-After is not exposed to scripts by any provider (ADR 0012).
const RETRY_DELAYS_MS = [2_000, 8_000];
const CALL_LIMIT_MS = 60_000;

/** Body fields that turn reasoning off, only where the provider accepts them. */
const REASONING_OFF: Readonly<Record<AiProvider, Readonly<Record<string, string>>>> = {
  groq: {},
  // Any extra parameter would narrow `require_parameters` routing.
  openrouter: {},
  mistral: {},
  local: { reasoning_effort: "none" },
};

const STATUS_KINDS = new Map<number, AiErrorKind>([
  [401, "auth"],
  [402, "quota"],
  [403, "forbidden"],
  [404, "model-not-found"],
  [408, "timeout"],
  [413, "too-large"],
]);

// OpenAI `code`, OpenRouter `metadata.error_type` and Mistral `type` values from their error docs.
const CODE_KINDS = new Map<string, AiErrorKind>([
  ["invalid_api_key", "auth"],
  ["authentication", "auth"],
  ["permission_denied", "forbidden"],
  ["content_policy_violation", "forbidden"],
  ["model_not_found", "model-not-found"],
  ["not_found", "model-not-found"],
  ["invalid_model", "model-not-found"],
  ["rate_limit_exceeded", "rate-limited"],
  ["insufficient_quota", "quota"],
  ["payment_required", "quota"],
  ["context_length_exceeded", "too-large"],
  ["max_tokens_exceeded", "too-large"],
  ["token_limit_exceeded", "too-large"],
  ["payload_too_large", "too-large"],
  ["timeout", "timeout"],
]);

// Errors that come without any code, as recorded.
const MESSAGE_KINDS: readonly (readonly [RegExp, AiErrorKind])[] = [
  // OpenRouter, a 400 with only `code: 400`.
  [/is not a valid model id/i, "model-not-found"],
];

const nullable = <S extends z.ZodType>(schema: S) => schema.nullable().catch(null);

const ErrorBody = z.union([
  // OpenRouter: `code` is the HTTP status, also when the error comes inside a 200.
  z
    .object({
      error: z.object({
        code: z.number().int(),
        message: z.string(),
        metadata: nullable(z.object({ error_type: z.string() })),
      }),
    })
    .transform(({ error }) => ({
      status: error.code,
      code: error.metadata?.error_type ?? null,
      message: error.message,
    })),
  // OpenAI, Groq, Ollama.
  z
    .object({
      error: z.object({
        message: z.string(),
        code: nullable(z.string()),
        type: nullable(z.string()),
      }),
    })
    .transform(({ error }) => ({
      status: null,
      code: error.code ?? error.type,
      message: error.message,
    })),
  // Mistral, observed on 401 and 422.
  z
    .object({ detail: z.union([z.string(), z.array(z.object({ msg: z.string() }))]) })
    .transform(({ detail }) => ({
      status: null,
      code: null,
      message: typeof detail === "string" ? detail : detail.map((item) => item.msg).join("; "),
    })),
  // Mistral's documented `{object: "error", message, type}` and any other `{message}`.
  z
    .object({ message: z.string(), type: nullable(z.string()) })
    .transform((body) => ({ status: null, code: body.type, message: body.message })),
]);

const Completion = z.object({
  choices: z.tuple([z.object({ message: z.object({ content: z.string() }) })], z.unknown()),
});

const ModelList = z.object({
  data: z.array(z.object({ id: z.string(), supported_parameters: nullable(z.array(z.string())) })),
});

type Signals = {
  readonly caller: AbortSignal;
  readonly call: AbortSignal;
  readonly deadline: number;
};

const invalid = (detail: ValidationError | string): AiError => ({
  kind: "invalid-response",
  status: null,
  message:
    typeof detail === "string"
      ? detail
      : detail.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
});

const interrupted = (signals: Signals): AiError | null => {
  if (signals.caller.aborted) return { kind: "aborted", status: null, message: null };
  if (signals.call.aborted) return { kind: "timeout", status: null, message: null };
  return null;
};

const providerError = (httpStatus: number, body: unknown): AiError => {
  const parsed = ErrorBody.safeParse(body);
  const detail = parsed.success ? parsed.data : { status: null, code: null, message: null };
  const status = httpStatus === 200 ? (detail.status ?? httpStatus) : httpStatus;
  const kind =
    STATUS_KINDS.get(status) ??
    CODE_KINDS.get(detail.code ?? "") ??
    MESSAGE_KINDS.find(([pattern]) => pattern.test(detail.message ?? ""))?.[1] ??
    (status === 429 ? "rate-limited" : "server");
  return { kind, status, message: detail.message };
};

const retryable = (error: AiError): boolean =>
  error.kind === "rate-limited" || (error.status !== null && error.status >= 500);

// A 400 that no known code explains, sent in json_schema mode, is the endpoint refusing the mode.
const refusesSchema = (error: AiError): boolean => error.status === 400 && error.kind === "server";

const parseJson = (text: string): Result<unknown, AiError> => {
  try {
    const value: unknown = JSON.parse(text);
    return ok(value);
  } catch {
    return err(invalid("The response is not JSON."));
  }
};

const isErrorInside = (body: unknown): boolean =>
  typeof body === "object" && body !== null && "error" in body && !("choices" in body);

const send = async (
  endpoint: AiEndpoint,
  path: string,
  body: object | null,
  signals: Signals,
): Promise<Result<unknown, AiError>> => {
  let status: number;
  let text: string;
  try {
    const response = await fetch(`${endpoint.baseUrl.replace(/\/+$/, "")}${path}`, {
      method: body === null ? "GET" : "POST",
      headers: {
        ...(body === null ? {} : { "Content-Type": "application/json" }),
        ...(endpoint.key === null ? {} : { Authorization: `Bearer ${endpoint.key}` }),
      },
      body: body === null ? null : JSON.stringify(body),
      signal: signals.call,
    });
    status = response.status;
    text = await response.text();
  } catch {
    return err(interrupted(signals) ?? { kind: "network", status: null, message: null });
  }
  const json = parseJson(text);
  if (status < 200 || status > 299) return err(providerError(status, json.ok ? json.value : null));
  if (!json.ok) return json;
  if (isErrorInside(json.value)) return err(providerError(status, json.value));
  return json;
};

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });

const retrying = async <T>(
  signals: Signals,
  attempt: () => Promise<Result<T, AiError>>,
): Promise<Result<T, AiError>> => {
  let result = await attempt();
  for (const delay of RETRY_DELAYS_MS) {
    if (result.ok || !retryable(result.error) || Date.now() + delay >= signals.deadline) {
      return result;
    }
    await sleep(delay, signals.call);
    const stop = interrupted(signals);
    if (stop !== null) return err(stop);
    result = await attempt();
  }
  return result;
};

const withDeadline = async <T>(
  caller: AbortSignal,
  run: (signals: Signals) => Promise<Result<T, AiError>>,
): Promise<Result<T, AiError>> => {
  const limit = new AbortController();
  const timer = setTimeout(() => {
    limit.abort();
  }, CALL_LIMIT_MS);
  try {
    return await run({
      caller,
      call: AbortSignal.any([caller, limit.signal]),
      deadline: Date.now() + CALL_LIMIT_MS,
    });
  } finally {
    clearTimeout(timer);
  }
};

const jsonSchema = (schema: z.ZodType): Record<string, unknown> =>
  Object.fromEntries(Object.entries(z.toJSONSchema(schema)).filter(([key]) => key !== "$schema"));

const withSchemaPrompt = (
  messages: readonly ChatMessage[],
  schema: Record<string, unknown>,
): readonly ChatMessage[] => {
  const instruction = `Answer with one JSON object that follows this JSON Schema:\n${JSON.stringify(schema)}`;
  const [first, ...rest] = messages;
  return first?.role === "system"
    ? [{ role: "system", content: `${first.content}\n\n${instruction}` }, ...rest]
    : [{ role: "system", content: instruction }, ...messages];
};

const chatBody = <T>(request: AiChatRequest<T>, mode: StructuredMode): object => {
  const schema = jsonSchema(request.schema);
  const { provider } = request.endpoint;
  return {
    model: request.model,
    messages:
      mode === "json_schema" ? request.messages : withSchemaPrompt(request.messages, schema),
    response_format:
      mode === "json_schema"
        ? { type: "json_schema", json_schema: { name: "answer", strict: true, schema } }
        : { type: "json_object" },
    ...(provider === "openrouter" ? { provider: { require_parameters: true } } : {}),
    ...REASONING_OFF[provider],
  };
};

const answerOf = <T>(body: unknown, schema: z.ZodType<T>): Result<T, AiError> => {
  const completion = parseWith(Completion, body);
  if (!completion.ok) return err(invalid(completion.error));
  const json = parseJson(completion.value.choices[0].message.content);
  if (!json.ok) return json;
  const value = parseWith(schema, json.value);
  return value.ok ? value : err(invalid(value.error));
};

/** One structured chat call; `mode` is the one that worked last time for this endpoint and model. */
export const chat = <T>(request: AiChatRequest<T>): Promise<Result<AiAnswer<T>, AiError>> =>
  withDeadline(request.signal, async (signals) => {
    const ask = (mode: StructuredMode) =>
      retrying(signals, () =>
        send(request.endpoint, "/chat/completions", chatBody(request, mode), signals),
      );
    let mode = request.mode;
    let sent = await ask(mode);
    if (!sent.ok && mode === "json_schema" && refusesSchema(sent.error)) {
      mode = "json_object";
      sent = await ask(mode);
    }
    if (!sent.ok) return sent;
    const answer = answerOf(sent.value, request.schema);
    return answer.ok ? ok({ value: answer.value, mode }) : answer;
  });

/** Model ids from `GET /models`; on OpenRouter, only those with structured outputs. */
export const listModels = (
  endpoint: AiEndpoint,
  signal: AbortSignal,
): Promise<Result<readonly string[], AiError>> =>
  withDeadline(signal, async (signals) => {
    const sent = await retrying(signals, () => send(endpoint, "/models", null, signals));
    if (!sent.ok) return sent;
    const list = parseWith(ModelList, sent.value);
    if (!list.ok) return err(invalid(list.error));
    return ok(
      list.value.data
        .filter(
          (model) =>
            endpoint.provider !== "openrouter" ||
            model.supported_parameters?.includes("structured_outputs") === true,
        )
        .map((model) => model.id),
    );
  });
