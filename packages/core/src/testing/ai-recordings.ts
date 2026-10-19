import { readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { z } from "zod";
import type { AiProvider } from "../ai-client.ts";
import type { ChatMessage } from "../prompt-pack.ts";

export const SCENARIOS = [
  "models",
  "success",
  "schema-violation",
  "unauthorized",
  "unknown-model",
  "rate-limited",
  "fallback",
  "reasoning-off",
  "error-in-200",
] as const;

export type Scenario = (typeof SCENARIOS)[number];

export const RECORDING_SCHEMA = z.object({
  word: z.string(),
  pinyin: z.string(),
  meaning: z.string(),
});

export const RECORDING_MESSAGES: readonly ChatMessage[] = [
  { role: "system", content: "You help a learner of Chinese. Answer in JSON." },
  { role: "user", content: "Give one common Chinese word for water, its pinyin and its meaning." },
];

/** A real answer that breaks RECORDING_SCHEMA: the tests replay it against that schema. */
export const COLOUR_SCHEMA = z.object({ colour: z.string() });

export const COLOUR_MESSAGES: readonly ChatMessage[] = [
  { role: "system", content: "Answer in JSON." },
  { role: "user", content: "Name one colour in English." },
];

export const UNKNOWN_MODEL = "openlinguo/no-such-model";
export const INVALID_KEY = "invalid-openlinguo-key";

const Exchange = z.object({
  request: z.object({ method: z.string(), path: z.string(), body: z.unknown() }),
  response: z.object({ status: z.number().int(), body: z.unknown() }),
});

export const Recording = z.object({
  recordedAt: z.iso.date(),
  provider: z.enum(["groq", "openrouter", "mistral", "local"]),
  scenario: z.enum(SCENARIOS),
  model: z.string().nullable(),
  exchanges: z.array(Exchange).min(1),
});

export type Recording = z.output<typeof Recording>;
export type Exchange = z.output<typeof Exchange>;

export const recordingUrl = (provider: AiProvider, scenario: Scenario): URL =>
  new URL(`./ai-responses/${provider}/${scenario}.json`, import.meta.url);

export const KEY_VARIABLES: Readonly<Record<AiProvider, string | null>> = {
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  local: null,
};

/** Reads a key from the terminal without echoing it. */
export const askHidden = async (question: string): Promise<string> => {
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

/** Redacts request ids, and drops volatile ids unless `keepIds` (a model listing). */
export const strip = (value: unknown, keepIds: boolean): unknown => {
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

/** A recording is never written when this holds: the key itself or anything shaped like one. */
export const holdsKey = (text: string, key: string | null): boolean =>
  (key !== null && text.includes(key)) || KEY_SHAPES.test(text);

export const loadRecording = (provider: AiProvider, scenario: Scenario): Recording => {
  let text: string;
  try {
    text = readFileSync(recordingUrl(provider, scenario), "utf8");
  } catch {
    throw new Error(
      `Missing recording ${provider}/${scenario}: run pnpm --filter @openlinguo/core record:ai`,
    );
  }
  return Recording.parse(JSON.parse(text));
};
