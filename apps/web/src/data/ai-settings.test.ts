import "fake-indexeddb/auto";
import { AI_BASE_URLS, inMemoryDictionary, ok, type AiEndpoint } from "@openlinguo/core";
import { createZhPack } from "@openlinguo/lang-zh";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import groqUnauthorized from "../../../../packages/core/src/testing/ai-responses/groq/unauthorized.json?raw";
import groqVocabulary from "../../e2e/fixtures/ai/groq-vocabulary.json?raw";
import localTest from "../../e2e/fixtures/ai/local-connection-test.json?raw";
import {
  aiConnection,
  DEFAULT_AI_SETTINGS,
  loadAiConnection,
  loadAiSettings,
  localBaseUrl,
  rememberMode,
  PROVIDER_FACTS_CHECKED_ON,
  RECOMMENDED_MODEL,
  recommendedModel,
  saveAiSettings,
  testConnection,
  type AiSettings,
} from "./ai-settings.ts";
import { openDatabase, type Database } from "./database.ts";

const DAY = 24 * 60 * 60_000;
const KEY = "gsk_test-key-never-sent-elsewhere";

const prompts = createZhPack({
  lookup: inMemoryDictionary([]),
  lexicon: new Set(),
  proficiency: "hsk-2025",
  decompositions: new Map(),
  strokesOf: () => Promise.resolve(ok(null)),
  wordsOfPinyin: () => Promise.resolve(ok([])),
}).prompts;
if (prompts === null) throw new Error("the zh pack has no prompts");

const groq: AiSettings = {
  ...DEFAULT_AI_SETTINGS,
  provider: "groq",
  key: { provider: "groq", value: KEY },
  model: { provider: "groq", id: "openai/gpt-oss-20b", mode: "json_schema" },
};

let db: Database;
let count = 0;

beforeEach(async () => {
  count += 1;
  db = openDatabase(`ai-settings-${String(count)}`);
  await saveAiSettings(db, DEFAULT_AI_SETTINGS);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI settings", () => {
  it("start with no provider, so the AI features stay hidden", async () => {
    await db.aiSettings.clear();
    expect(await loadAiSettings(db)).toEqual(ok(DEFAULT_AI_SETTINGS));
    expect(await loadAiConnection(db)).toEqual(ok(null));
  });

  it("keep the provider, model and key on this device", async () => {
    expect(await saveAiSettings(db, groq)).toEqual(ok(null));
    expect(await loadAiSettings(db)).toEqual(ok(groq));
    expect(await loadAiConnection(db)).toEqual(
      ok({
        endpoint: { provider: "groq", baseUrl: AI_BASE_URLS.groq, key: KEY },
        model: "openai/gpt-oss-20b",
        mode: "json_schema",
      }),
    );
  });

  it("keep a key not to remember in memory only", async () => {
    await saveAiSettings(db, { ...groq, rememberKey: false });
    expect((await db.aiSettings.toArray()).map(({ key }) => key)).toEqual([null]);
    expect(await loadAiSettings(db)).toEqual(ok({ ...groq, rememberKey: false }));

    await saveAiSettings(db, groq);
    expect((await db.aiSettings.toArray()).map(({ key }) => key)).toEqual([groq.key]);
  });

  it("forget the key", async () => {
    await saveAiSettings(db, groq);
    await saveAiSettings(db, { ...groq, key: null });
    expect(JSON.stringify(await db.aiSettings.toArray())).not.toContain(KEY);
    expect(await loadAiConnection(db)).toEqual(ok(null));
  });

  it("use a key and a model with the provider they were set for only", async () => {
    await saveAiSettings(db, { ...groq, provider: "mistral" });
    expect(await loadAiConnection(db)).toEqual(ok(null));
    await saveAiSettings(db, groq);
    expect((await loadAiConnection(db)).ok).toBe(true);
  });

  it("reach a local server without a key", () => {
    const local: AiSettings = {
      ...groq,
      provider: "local",
      model: { provider: "local", id: "qwen3:30b-a3b", mode: "json_object" },
    };
    expect(aiConnection(local)).toEqual({
      endpoint: { provider: "local", baseUrl: "http://localhost:11434/v1", key: null },
      model: "qwen3:30b-a3b",
      mode: "json_object",
    });
    expect(aiConnection({ ...local, localAddress: "http://192.168.1.2:11434" })).toBeNull();
  });

  it("accept a local server on localhost or 127.0.0.1 only, as the CSP does", () => {
    expect(localBaseUrl(" http://localhost:1234/ ")).toBe("http://localhost:1234/v1");
    expect(localBaseUrl("http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434/v1");
    for (const refused of [
      "https://localhost:11434",
      "http://localhost.example.com:11434",
      "http://[::1]:11434",
      "http://localhost:11434/v1",
      "http://user@localhost:11434",
      "localhost:11434",
      "",
    ]) {
      expect(localBaseUrl(refused), refused).toBeNull();
    }
  });

  it("report storage failures", async () => {
    db.close();
    const saved = await saveAiSettings(db, groq);
    expect(saved.ok ? null : saved.error.kind).toBe("storage");
    expect((await loadAiSettings(db)).ok).toBe(false);
  });

  it("have provider facts checked in the last six months: check the links and catalog lines again", () => {
    expect(Date.now() - Date.parse(PROVIDER_FACTS_CHECKED_ON)).toBeLessThan(183 * DAY);
  });
});

describe("recommendedModel", () => {
  const listed = ["openai/gpt-oss-120b", RECOMMENDED_MODEL.id];
  const before = Date.parse(RECOMMENDED_MODEL.reviewBy) - DAY;

  it("is the recorded Groq model, while Groq lists it", () => {
    const recording = z
      .object({ provider: z.string(), model: z.string() })
      .parse(JSON.parse(groqVocabulary));
    expect(recording).toEqual({
      provider: RECOMMENDED_MODEL.provider,
      model: RECOMMENDED_MODEL.id,
    });
    expect(recommendedModel("groq", listed, before)).toBe(RECOMMENDED_MODEL.id);
    expect(recommendedModel("groq", ["openai/gpt-oss-120b"], before)).toBeNull();
    expect(recommendedModel("openrouter", listed, before)).toBeNull();
  });

  it("is withdrawn on its review date rather than kept stale", () => {
    expect(recommendedModel("groq", listed, Date.parse(RECOMMENDED_MODEL.reviewBy))).toBeNull();
  });

  it("was tested less than three months ago: test it again, then move checkedOn and reviewBy", () => {
    expect(Date.now()).toBeLessThan(Date.parse(RECOMMENDED_MODEL.reviewBy));
    expect(Date.parse(RECOMMENDED_MODEL.reviewBy) - Date.parse(RECOMMENDED_MODEL.checkedOn)).toBe(
      92 * DAY,
    );
  });
});

const Recording = z.object({
  exchanges: z.array(
    z.object({
      request: z.object({ method: z.string(), path: z.string() }),
      response: z.object({ status: z.number().int(), body: z.unknown() }),
    }),
  ),
});

type Sent = { readonly url: string; readonly authorization: string | null };

/** Answers each request with the recorded exchange of its method and path. */
const replay = (recording: string): Sent[] => {
  const { exchanges } = Recording.parse(JSON.parse(recording));
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", (input: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    sent.push({ url: input, authorization: headers.get("Authorization") });
    const exchange =
      exchanges.find(({ request }) => request.method === method && input.endsWith(request.path)) ??
      null;
    if (exchange === null) return Promise.reject(new TypeError(`no recording: ${method} ${input}`));
    const { status, body } = exchange.response;
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  return sent;
};

const local: AiEndpoint = { provider: "local", baseUrl: "http://localhost:11434/v1", key: null };
const test = (endpoint: AiEndpoint, model: AiSettings["model"]) =>
  testConnection(endpoint, model, prompts.correction, "en", new AbortController().signal);

describe("rememberMode", () => {
  it("keeps the mode a call ended with, for the model it was sent to only", async () => {
    await saveAiSettings(db, groq);
    const connection = aiConnection(groq);
    if (connection === null) throw new Error("no connection");
    expect(await rememberMode(db, connection, "json_object")).toEqual(ok(null));
    expect(await loadAiConnection(db)).toEqual(ok({ ...connection, mode: "json_object" }));
    const other = { provider: "groq", id: "other", mode: "json_object" } as const;
    await saveAiSettings(db, { ...groq, model: other });
    expect(await rememberMode(db, connection, "json_schema")).toEqual(ok(null));
    expect(await loadAiSettings(db)).toEqual(ok({ ...groq, model: other }));
  });
});

describe("testConnection", () => {
  it("lists the models, then corrects the test sentence with the chosen one", async () => {
    const sent = replay(localTest);
    const model = { provider: "local", id: "qwen3:30b-a3b", mode: "json_schema" } as const;
    expect(await test(local, model)).toEqual({
      models: ["gemma3:4b", "qwen3:30b-a3b", "mxbai-embed-large:latest"],
      answer: ok(model),
    });
    expect(sent).toEqual([
      { url: "http://localhost:11434/v1/models", authorization: null },
      { url: "http://localhost:11434/v1/chat/completions", authorization: null },
    ]);
  });

  it("only lists the models while none is chosen", async () => {
    const sent = replay(localTest);
    expect(await test(local, null)).toEqual({
      models: ["gemma3:4b", "qwen3:30b-a3b", "mxbai-embed-large:latest"],
      answer: ok(null),
    });
    expect(sent).toHaveLength(1);
  });

  it("names a chosen model the endpoint no longer lists", async () => {
    const sent = replay(localTest);
    const result = await test(local, { provider: "local", id: "gone:1b", mode: "json_schema" });
    expect(result.answer).toEqual({
      ok: false,
      error: { kind: "model-not-found", status: null, message: null },
    });
    expect(sent).toHaveLength(1);
  });

  it("sends the key to its provider and reports a refused key", async () => {
    const sent = replay(
      groqUnauthorized.replace('"POST"', '"GET"').replace("/chat/completions", "/models"),
    );
    const endpoint: AiEndpoint = { provider: "groq", baseUrl: AI_BASE_URLS.groq, key: KEY };
    const result = await test(endpoint, groq.model);
    expect(result.models).toBeNull();
    expect(result.answer.ok ? null : result.answer.error.kind).toBe("auth");
    expect(sent).toEqual([{ url: `${AI_BASE_URLS.groq}/models`, authorization: `Bearer ${KEY}` }]);
  });
});
