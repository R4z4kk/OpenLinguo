// Records real provider responses for the AI client tests.
// Usage: pnpm --filter @openlinguo/core record:ai <provider>=<model>[,<model without strict json_schema>] ...
// Keys come from GROQ_API_KEY, OPENROUTER_API_KEY, MISTRAL_API_KEY or a hidden prompt, and are never written.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { argv, env, exit, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { z } from "zod";
import {
  AI_BASE_URLS,
  chat,
  listModels,
  type AiEndpoint,
  type AiError,
  type AiProvider,
  type StructuredMode,
} from "../ai-client.ts";
import type { ChatMessage } from "../prompt-pack.ts";
import type { Result } from "../result.ts";
import {
  INVALID_KEY,
  COLOUR_MESSAGES,
  COLOUR_SCHEMA,
  RECORDING_MESSAGES,
  RECORDING_SCHEMA,
  recordingUrl,
  UNKNOWN_MODEL,
  type Exchange,
  type Recording,
  type Scenario,
} from "./ai-recordings.ts";

const KEY_VARIABLES: Readonly<Record<AiProvider, string | null>> = {
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  local: null,
};

const CLOUD: readonly AiProvider[] = ["groq", "openrouter", "mistral"];
const KEY_SHAPES = /gsk_[A-Za-z0-9]{20,}|sk-or-v1-[a-f0-9]{20,}|sk-[A-Za-z0-9-]{20,}/;
const DROPPED_KEYS = new Set(["id", "created", "system_fingerprint"]);
const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  [/\borg_[A-Za-z0-9]+/g, "org_redacted"],
  [/\breq_[A-Za-z0-9]+/g, "req_redacted"],
  [/\buser_[A-Za-z0-9]+/g, "user_redacted"],
  [/\bgen-[A-Za-z0-9-]+/g, "gen-redacted"],
  [/\bchatcmpl-[A-Za-z0-9-]+/g, "chatcmpl-redacted"],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "redacted-uuid"],
];

type Run = {
  readonly provider: AiProvider;
  readonly model: string;
  readonly fallbackModel: string | null;
  readonly key: string | null;
};

type Capture = { readonly got: string; readonly exchanges: readonly Exchange[] };

type Plan = {
  readonly scenario: Scenario;
  readonly providers: readonly AiProvider[];
  readonly withoutKey: readonly AiProvider[];
  readonly expected: string;
  readonly capture: (run: Run) => Promise<Capture>;
};

let tape: Exchange[] = [];
let onExchange: ((exchange: Exchange) => void) | null = null;
const errorsInside200: Exchange[] = [];

const parseBody = (text: string): unknown => {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return text;
  }
};

const isErrorInside = (body: unknown): boolean =>
  typeof body === "object" && body !== null && "error" in body && !("choices" in body);

const realFetch = globalThis.fetch;
globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
  const [input, init] = args;
  const response = await realFetch(...args);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const base = Object.values(AI_BASE_URLS).find((prefix) => url.startsWith(prefix)) ?? "";
  const exchange: Exchange = {
    request: {
      method: init?.method ?? "GET",
      path: url.slice(base.length),
      body: typeof init?.body === "string" ? parseBody(init.body) : null,
    },
    response: { status: response.status, body: parseBody(await response.clone().text()) },
  };
  tape.push(exchange);
  if (exchange.response.status === 200 && isErrorInside(exchange.response.body)) {
    errorsInside200.push(exchange);
  }
  onExchange?.(exchange);
  return response;
};

const endpointOf = (run: Run, key: string | null): AiEndpoint => ({
  provider: run.provider,
  baseUrl: AI_BASE_URLS[run.provider],
  key,
});

const outcome = (result: Result<{ readonly mode: StructuredMode }, AiError>): string =>
  result.ok
    ? `ok ${result.value.mode}`
    : `${result.error.kind} ${String(result.error.status)} ${result.error.message ?? ""}`;

const ask = (
  endpoint: AiEndpoint,
  model: string,
  messages: readonly ChatMessage[],
  mode: StructuredMode,
  signal: AbortSignal,
) => chat({ endpoint, model, messages, schema: RECORDING_SCHEMA, mode, signal });

const taped = async (record: () => Promise<string>): Promise<Capture> => {
  tape = [];
  const got = await record();
  return { got, exchanges: tape };
};

const rateLimited = async (run: Run): Promise<Capture> => {
  const stop = new AbortController();
  const hits: Exchange[] = [];
  onExchange = (exchange) => {
    if (exchange.response.status === 429 && hits.length === 0) {
      hits.push(exchange);
      stop.abort();
    }
  };
  for (let wave = 0; wave < 6 && hits.length === 0; wave += 1) {
    await Promise.all(
      Array.from({ length: 10 }, () =>
        ask(endpointOf(run, run.key), run.model, RECORDING_MESSAGES, "json_object", stop.signal),
      ),
    );
  }
  onExchange = null;
  return { got: hits.length === 0 ? "no 429 after 60 calls" : "429", exchanges: hits };
};

const reasoningOff = (run: Run): Promise<Capture> =>
  taped(async () => {
    const response = await fetch(`${AI_BASE_URLS[run.provider]}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(run.key === null ? {} : { Authorization: `Bearer ${run.key}` }),
      },
      body: JSON.stringify({
        model: run.model,
        messages: RECORDING_MESSAGES,
        reasoning_effort: "none",
      }),
      signal: AbortSignal.timeout(60_000),
    });
    await response.text();
    return `measured: HTTP ${String(response.status)}, ${response.ok ? "accepted" : "refused"}`;
  });

const PLANS: readonly Plan[] = [
  {
    scenario: "models",
    providers: ["groq", "openrouter", "mistral", "local"],
    withoutKey: ["openrouter"],
    expected: "ok",
    capture: (run) =>
      taped(async () => {
        const result = await listModels(endpointOf(run, run.key), new AbortController().signal);
        return result.ok ? "ok" : outcome(result);
      }),
  },
  {
    scenario: "success",
    providers: ["groq", "openrouter", "mistral", "local"],
    withoutKey: [],
    expected: "ok json_schema",
    capture: (run) =>
      taped(async () =>
        outcome(
          await ask(
            endpointOf(run, run.key),
            run.model,
            RECORDING_MESSAGES,
            "json_schema",
            new AbortController().signal,
          ),
        ),
      ),
  },
  {
    scenario: "schema-violation",
    providers: ["groq", "openrouter", "mistral", "local"],
    withoutKey: [],
    expected: "breaks RECORDING_SCHEMA",
    capture: (run) =>
      taped(async () => {
        const result = await chat({
          endpoint: endpointOf(run, run.key),
          model: run.model,
          messages: COLOUR_MESSAGES,
          schema: COLOUR_SCHEMA,
          mode: "json_schema",
          signal: new AbortController().signal,
        });
        return result.ok && !RECORDING_SCHEMA.safeParse(result.value.value).success
          ? "breaks RECORDING_SCHEMA"
          : outcome(result);
      }),
  },
  {
    scenario: "unauthorized",
    providers: CLOUD,
    withoutKey: CLOUD,
    expected: "auth",
    capture: (run) =>
      taped(async () =>
        outcome(
          await ask(
            endpointOf(run, INVALID_KEY),
            run.model,
            RECORDING_MESSAGES,
            "json_schema",
            new AbortController().signal,
          ),
        ),
      ),
  },
  {
    scenario: "unknown-model",
    providers: ["groq", "openrouter", "mistral", "local"],
    withoutKey: [],
    expected: "model-not-found",
    capture: (run) =>
      taped(async () =>
        outcome(
          await ask(
            endpointOf(run, run.key),
            UNKNOWN_MODEL,
            RECORDING_MESSAGES,
            "json_schema",
            new AbortController().signal,
          ),
        ),
      ),
  },
  {
    scenario: "fallback",
    providers: ["groq", "openrouter", "mistral", "local"],
    withoutKey: [],
    expected: "ok json_object",
    capture: (run) =>
      taped(async () =>
        outcome(
          await ask(
            endpointOf(run, run.key),
            run.fallbackModel ?? run.model,
            RECORDING_MESSAGES,
            "json_schema",
            new AbortController().signal,
          ),
        ),
      ),
  },
  {
    scenario: "reasoning-off",
    providers: ["groq", "mistral", "local"],
    withoutKey: [],
    expected: "measured",
    capture: reasoningOff,
  },
  {
    scenario: "rate-limited",
    providers: CLOUD,
    withoutKey: [],
    expected: "429",
    capture: rateLimited,
  },
];

const strip = (value: unknown, keepIds: boolean): unknown => {
  if (typeof value === "string") {
    return REDACTIONS.reduce((text, [pattern, by]) => text.replace(pattern, by), value);
  }
  if (Array.isArray(value)) return value.map((item: unknown) => strip(item, keepIds));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => keepIds || !DROPPED_KEYS.has(key))
        .map(([key, item]: [string, unknown]) => [key, strip(item, keepIds)]),
    );
  }
  return value;
};

const hasStructuredOutputs = (model: unknown): boolean =>
  z
    .object({ supported_parameters: z.array(z.string()) })
    .safeParse(model)
    .data?.supported_parameters.includes("structured_outputs") === true;

const trimModels = (body: unknown): unknown => {
  const listing = z.looseObject({ data: z.array(z.unknown()) }).safeParse(body);
  if (!listing.success) return body;
  const structured = listing.data.data.filter(hasStructuredOutputs);
  const others = listing.data.data.filter((model) => !hasStructuredOutputs(model));
  const short = (model: unknown): unknown =>
    typeof model === "object" && model !== null
      ? Object.fromEntries(Object.entries(model).filter(([key]) => key !== "description"))
      : model;
  return {
    ...listing.data,
    data: [...structured.slice(0, 3), ...others.slice(0, 3)].map(short),
  };
};

const sanitize = (exchange: Exchange): Exchange => {
  const isList = exchange.request.path === "/models";
  return {
    request: { ...exchange.request, body: strip(exchange.request.body, false) },
    response: {
      status: exchange.response.status,
      body: strip(isList ? trimModels(exchange.response.body) : exchange.response.body, isList),
    },
  };
};

const save = async (
  run: Run,
  scenario: Scenario,
  model: string | null,
  exchanges: readonly Exchange[],
) => {
  const recording: Recording = {
    recordedAt: new Date().toISOString().slice(0, 10),
    provider: run.provider,
    scenario,
    model,
    exchanges: exchanges.map(sanitize),
  };
  const text = JSON.stringify(recording, null, 2);
  if ((run.key !== null && text.includes(run.key)) || KEY_SHAPES.test(text)) {
    throw new Error(`${run.provider}/${scenario} looks like it contains a key: not written`);
  }
  const file = fileURLToPath(recordingUrl(run.provider, scenario));
  mkdirSync(dirname(file), { recursive: true });
  const options = await resolveConfig(file);
  writeFileSync(file, await format(text, { ...(options ?? {}), filepath: file }));
};

const askHidden = async (question: string): Promise<string> => {
  stdout.write(question);
  const muted = new Writable({
    write: (_chunk, _encoding, callback) => {
      callback();
    },
  });
  const prompt = createInterface({ input: stdin, output: muted, terminal: true });
  try {
    return (await prompt.question("")).trim();
  } finally {
    prompt.close();
    stdout.write("\n");
  }
};

const keyFor = async (provider: AiProvider): Promise<string | null> => {
  const variable = KEY_VARIABLES[provider];
  if (variable === null) return null;
  const fromEnv = env[variable] ?? "";
  if (fromEnv !== "") return fromEnv;
  if (!stdin.isTTY) return null;
  const typed = await askHidden(`${provider} key (empty: keyless scenarios only): `);
  return typed === "" ? null : typed;
};

const isProvider = (value: string): value is AiProvider => Object.hasOwn(AI_BASE_URLS, value);

const record = async (run: Run) => {
  const keyless = run.key === null && run.provider !== "local";
  errorsInside200.length = 0;
  for (const plan of PLANS) {
    const label = `${run.provider}/${plan.scenario}`;
    if (!plan.providers.includes(run.provider)) continue;
    if (
      (keyless && !plan.withoutKey.includes(run.provider)) ||
      (plan.scenario === "fallback" && run.fallbackModel === null)
    ) {
      console.log(`${label}: skipped`);
      continue;
    }
    try {
      const { got, exchanges } = await plan.capture(run);
      const mark = got.startsWith(plan.expected) ? "  " : "! ";
      console.log(`${mark}${label}: expected ${plan.expected}, got ${got}`);
      if (exchanges.length > 0) {
        const model = plan.scenario === "fallback" ? run.fallbackModel : run.model;
        await save(run, plan.scenario, plan.scenario === "models" ? null : model, exchanges);
      }
    } catch (error) {
      console.log(`! ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (run.provider === "openrouter" && !keyless) {
    if (errorsInside200.length === 0) {
      console.log("! openrouter/error-in-200: none seen during this run");
    } else {
      await save(run, "error-in-200", run.model, errorsInside200.slice(0, 1));
      console.log("  openrouter/error-in-200: recorded");
    }
  }
};

const runs: Run[] = [];
for (const arg of argv.slice(2)) {
  const [provider = "", models = ""] = arg.split("=");
  const [model = "", fallbackModel = ""] = models.split(",");
  if (!isProvider(provider) || model === "") {
    console.error(`Expected <provider>=<model>[,<fallback model>], got ${arg}`);
    exit(1);
  }
  runs.push({
    provider,
    model,
    fallbackModel: fallbackModel === "" ? null : fallbackModel,
    key: await keyFor(provider),
  });
}
if (runs.length === 0) {
  console.error("Expected at least one <provider>=<model> argument");
  exit(1);
}
for (const run of runs) await record(run);
