// Records a real model list and answer to the zh vocabulary prompt, replayed by the interests E2E
// (#187).
// Usage: pnpm --filter @openlinguo/web record:ai <provider>=<model>
// The key comes from GROQ_API_KEY, OPENROUTER_API_KEY, MISTRAL_API_KEY or a hidden prompt, and is
// never written.
import { writeFile } from "node:fs/promises";
import { argv, env, exit, stdin } from "node:process";
import { fileURLToPath } from "node:url";
import { AI_BASE_URLS, AI_PROVIDERS, chat, listModels, ok, type AiError } from "@openlinguo/core";
import { createPrompts } from "@openlinguo/lang-zh";
import { format, resolveConfig } from "prettier";
import { z } from "zod";
import {
  askHidden,
  holdsKey,
  KEY_VARIABLES,
  strip,
  type Exchange,
} from "../../../packages/core/src/testing/ai-recordings.ts";
import { en } from "../src/i18n/en.ts";

/** What the E2E sends: two themes and the note it types, at the first band of a new learner. */
const INPUT = {
  themes: [en.interests.theme.cooking, en.interests.theme.nature],
  note: "I like tea and hiking in the mountains.",
  level: 1,
  count: 10,
};

const fail = (message: string): never => {
  console.error(message);
  exit(1);
};

const parseBody = (text: string): unknown => {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return text;
  }
};

const USAGE = "Usage: record:ai <provider>=<model>";
const [target = ""] = argv.slice(2);
const [name = "", model = ""] = target.split(/=(.*)/su);
const chosen = z.enum(AI_PROVIDERS).safeParse(name).data ?? fail(USAGE);
if (model === "") fail(USAGE);
const keyOf = async (variable: string | null): Promise<string | null> => {
  if (variable === null) return null;
  const typed = env[variable] ?? (stdin.isTTY ? await askHidden(`${chosen} key: `) : "");
  return typed === "" ? fail(`No key: set ${variable} or type it.`) : typed;
};
const key = await keyOf(KEY_VARIABLES[chosen]);

const baseUrl = AI_BASE_URLS[chosen];
const tape: Exchange[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
  const [input, init] = args;
  const response = await realFetch(...args);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  tape.push({
    request: {
      method: init?.method ?? "GET",
      path: url.slice(baseUrl.length),
      body: typeof init?.body === "string" ? parseBody(init.body) : null,
    },
    response: { status: response.status, body: parseBody(await response.clone().text()) },
  });
  return response;
};

const failed = ({ kind, status, message }: AiError): never =>
  fail(`${kind} ${String(status)} ${message ?? ""}: nothing written`);

const endpoint = { provider: chosen, baseUrl, key };
const models = await listModels(endpoint, new AbortController().signal);
if (!models.ok) failed(models.error);
else if (!models.value.includes(model))
  fail(`${model} is not in ${chosen}'s list: nothing written`);

const { vocabulary } = createPrompts({
  lookup: () => Promise.resolve(ok([])),
  tokenize: () => [],
  proficiency: "hsk-2025",
});
const answer = await chat({
  endpoint,
  model,
  messages: vocabulary.messages(INPUT),
  schema: vocabulary.schema(INPUT),
  mode: "json_schema",
  signal: new AbortController().signal,
});
if (!answer.ok) {
  failed(answer.error);
} else {
  console.log(`${answer.value.mode}: ${answer.value.value.headwords.join(" ")}`);
}

const text = JSON.stringify(
  {
    recordedAt: new Date().toISOString().slice(0, 10),
    provider: chosen,
    model,
    exchanges: tape.map(({ request, response }) => ({
      request: { ...request, body: strip(request.body, false) },
      response: { status: response.status, body: strip(response.body, request.path === "/models") },
    })),
  },
  null,
  2,
);
if (holdsKey(text, key)) fail("The recording looks like it contains a key: nothing written");
const file = fileURLToPath(
  new URL(`../e2e/fixtures/ai/${chosen}-vocabulary.json`, import.meta.url),
);
await writeFile(
  file,
  await format(text, { ...((await resolveConfig(file)) ?? {}), filepath: file }),
);
console.log(`Written: ${file}`);
