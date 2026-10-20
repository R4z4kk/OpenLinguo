// Records a real model list and answer to a zh prompt, replayed by an E2E: the vocabulary prompt
// for interests (#187), the gloss prompt for the word page (#188), the correction prompt for the
// 5-sentence challenge (#183), the one-sentence correction of the AI settings' connection test (#181).
// Usage: pnpm --filter @openlinguo/web record:ai <provider>=<model> [vocabulary|gloss|correction|connection]
// The key comes from GROQ_API_KEY, OPENROUTER_API_KEY, MISTRAL_API_KEY or a hidden prompt, and is
// never written. LOCAL_BASE_URL replaces the local server's address.
import { writeFile } from "node:fs/promises";
import { argv, env, exit, stdin } from "node:process";
import { fileURLToPath } from "node:url";
import {
  AI_BASE_URLS,
  AI_PROVIDERS,
  chat,
  listModels,
  ok,
  type AiError,
  type PromptTask,
} from "@openlinguo/core";
import { createPrompts } from "@openlinguo/lang-zh";
import { format, resolveConfig } from "prettier";
import { z } from "zod";
import {
  askHidden,
  holdsKey,
  KEY_VARIABLES,
  strip,
  trimModels,
  type Exchange,
} from "../../../packages/core/src/testing/ai-recordings.ts";
import { TEST_SENTENCE } from "../src/data/ai-settings.ts";
import { en } from "../src/i18n/en.ts";

/** What the E2E sends: two themes and the note it types, at the first band of a new learner. */
const INPUT = {
  themes: [en.interests.theme.cooking, en.interests.theme.nature],
  note: "I like tea and hiking in the mountains.",
  level: 1,
  count: 10,
};

/** What the word page sends for 一路平安: HSK 2, no French gloss (data/gaps/missing-french.tsv). */
const GLOSS_INPUT = {
  headword: "一路平安",
  reading: "yi1 lu4 ping2 an1",
  glosses: ["to have a pleasant journey", "Bon voyage!"],
};

/** The challenge mockup's sentences, in the E2E's interface language. */
const CORRECTION_INPUT = {
  word: "电话",
  sentences: [
    "我给妈妈打电话。",
    "你的电话号码是多少？",
    "我电话很新。",
    "晚上我不想接电话。",
    "请你电话我。",
  ],
  language: "en",
} as const;

/** What « Tester la connexion » sends once the model list is read. */
const CONNECTION_INPUT = { word: null, sentences: [TEST_SENTENCE], language: "en" } as const;

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

const USAGE = "Usage: record:ai <provider>=<model> [vocabulary|gloss|correction|connection]";
const [target = "", taskName = "vocabulary"] = argv.slice(2);
const task =
  z.enum(["vocabulary", "gloss", "correction", "connection"]).safeParse(taskName).data ??
  fail(USAGE);
const [name = "", model = ""] = target.split(/=(.*)/su);
const chosen = z.enum(AI_PROVIDERS).safeParse(name).data ?? fail(USAGE);
if (model === "") fail(USAGE);
const keyOf = async (variable: string | null): Promise<string | null> => {
  if (variable === null) return null;
  const typed = env[variable] ?? (stdin.isTTY ? await askHidden(`${chosen} key: `) : "");
  return typed === "" ? fail(`No key: set ${variable} or type it.`) : typed;
};
const key = await keyOf(KEY_VARIABLES[chosen]);

const baseUrl =
  chosen === "local" ? (env["LOCAL_BASE_URL"] ?? AI_BASE_URLS.local) : AI_BASE_URLS[chosen];
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

const { vocabulary, glossTranslation, correction } = createPrompts({
  lookup: () => Promise.resolve(ok([])),
  tokenize: () => [],
  proficiency: "hsk-2025",
});
const ask = <I, A>(prompt: PromptTask<I, A>, input: I) =>
  chat({
    endpoint,
    model,
    messages: prompt.messages(input),
    schema: prompt.schema(input),
    mode: "json_schema",
    signal: new AbortController().signal,
  });
const answer =
  task === "gloss"
    ? await ask(glossTranslation, GLOSS_INPUT)
    : task === "correction"
      ? await ask(correction, CORRECTION_INPUT)
      : task === "connection"
        ? await ask(correction, CONNECTION_INPUT)
        : await ask(vocabulary, INPUT);
if (!answer.ok) {
  failed(answer.error);
} else {
  console.log(`${answer.value.mode}: ${JSON.stringify(answer.value.value)}`);
}

const text = JSON.stringify(
  {
    recordedAt: new Date().toISOString().slice(0, 10),
    provider: chosen,
    model,
    exchanges: tape.map(({ request, response }) => {
      const isList = request.path === "/models";
      return {
        request: { ...request, body: strip(request.body, false) },
        response: {
          status: response.status,
          body: strip(isList ? trimModels(response.body, model) : response.body, isList),
        },
      };
    }),
  },
  null,
  2,
);
if (holdsKey(text, key)) fail("The recording looks like it contains a key: nothing written");
const file = fileURLToPath(new URL(`../e2e/fixtures/ai/${chosen}-${task}.json`, import.meta.url));
await writeFile(
  file,
  await format(text, { ...((await resolveConfig(file)) ?? {}), filepath: file }),
);
console.log(`Written: ${file}`);
