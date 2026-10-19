import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AI_BASE_URLS,
  chat,
  listModels,
  type AiChatRequest,
  type AiEndpoint,
  type AiError,
  type AiProvider,
} from "./ai-client.ts";
import type { Result } from "./result.ts";
import {
  loadRecording,
  RECORDING_MESSAGES,
  RECORDING_SCHEMA,
  type Recording,
} from "./testing/ai-recordings.ts";

type Reply = { readonly status: number; readonly body: unknown; readonly delayMs: number };
type Call = { readonly url: string; readonly init: RequestInit; readonly at: number };
type Answer = z.output<typeof RECORDING_SCHEMA>;

const Listing = z.object({ data: z.array(z.object({ id: z.string() })) });
const CLOUD = ["groq", "openrouter", "mistral"] as const;
const PROVIDERS = [...CLOUD, "local"] as const;
// Recorded with a key; Mistral only without one (its API needs a paid plan).
const RECORDED = ["groq", "openrouter", "local"] as const;
// Probed with reasoning_effort "none"; OpenRouter gets no reasoning field by design.
const REASONING_PROBED = ["groq", "local"] as const;
const WATER = '{"word":"水","pinyin":"shuǐ","meaning":"water"}';

let calls: Call[] = [];
let start = 0;

const reply = (status: number, body: unknown, delayMs = 0): Reply => ({ status, body, delayMs });

const completion = (content: string | null) => ({
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
});

const serve = (...replies: readonly Reply[]) => {
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    calls.push({ url, init, at: Date.now() - start });
    const next = replies[Math.min(calls.length, replies.length) - 1];
    if (next == null) throw new Error("No reply to serve");
    const response = {
      status: next.status,
      text: () =>
        Promise.resolve(typeof next.body === "string" ? next.body : JSON.stringify(next.body)),
    };
    return new Promise((resolve, reject) => {
      const timer = Number.isFinite(next.delayMs)
        ? setTimeout(() => {
            resolve(response);
          }, next.delayMs)
        : null;
      init.signal?.addEventListener("abort", () => {
        if (timer !== null) clearTimeout(timer);
        reject(new DOMException("This operation was aborted", "AbortError"));
      });
    });
  });
};

const replay = (recording: Recording) => {
  serve(...recording.exchanges.map(({ response }) => reply(response.status, response.body)));
};

const settle = async <T>(pending: Promise<T>): Promise<T> => {
  await vi.runAllTimersAsync();
  return pending;
};

const endpoint = (provider: AiProvider, key: string | null): AiEndpoint => ({
  provider,
  baseUrl: AI_BASE_URLS[provider],
  key,
});

const ask = (provider: AiProvider, changes: Partial<AiChatRequest<Answer>>) =>
  chat({
    endpoint: endpoint(provider, "test-key"),
    model: "test-model",
    messages: RECORDING_MESSAGES,
    schema: RECORDING_SCHEMA,
    mode: "json_schema",
    signal: new AbortController().signal,
    ...changes,
  });

const answer = <T>(result: Result<T, AiError>): T => {
  if (!result.ok) throw new Error(`Expected an answer, got ${result.error.kind}`);
  return result.value;
};

const failure = <T>(result: Result<T, AiError>): AiError => {
  if (result.ok) throw new Error("Expected an error");
  return result.error;
};

const callAt = (index: number): Call => {
  const call = calls[index];
  if (call == null) throw new Error(`No call ${String(index)}`);
  return call;
};

const bodyOf = (call: Call): unknown => {
  const body: unknown = typeof call.init.body === "string" ? JSON.parse(call.init.body) : null;
  return body;
};

beforeEach(() => {
  calls = [];
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  start = Date.now();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each(RECORDED)("recorded %s responses", (provider) => {
  it("returns a structured answer and sends what was recorded", async () => {
    const recording = loadRecording(provider, "success");
    replay(recording);
    const result = answer(await settle(ask(provider, { model: recording.model ?? "" })));
    expect(result.mode).toBe("json_schema");
    expect(result.value.word).not.toBe("");
    expect(bodyOf(callAt(0))).toEqual(recording.exchanges[0]?.request.body);
  });

  it("rejects an answer that breaks the schema", async () => {
    replay(loadRecording(provider, "schema-violation"));
    const error = failure(await settle(ask(provider, {})));
    expect(error.kind).toBe("invalid-response");
  });

  it("reports an unknown model", async () => {
    replay(loadRecording(provider, "unknown-model"));
    const error = failure(await settle(ask(provider, {})));
    expect(error.kind).toBe("model-not-found");
    expect(error.message).not.toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe.each(RECORDED)("recorded %s model list", (provider) => {
  it("lists the models", async () => {
    const recording = loadRecording(provider, "models");
    replay(recording);
    const ids = answer(
      await settle(listModels(endpoint(provider, "test-key"), new AbortController().signal)),
    );
    const all = Listing.parse(recording.exchanges[0]?.response.body).data.map((model) => model.id);
    expect(ids.length).toBeGreaterThan(0);
    if (provider === "openrouter") {
      expect(all).toEqual(expect.arrayContaining([...ids]));
      expect(ids.length).toBeLessThan(all.length);
    } else {
      expect(ids).toEqual(all);
    }
  });
});

describe.each(PROVIDERS)("%s reasoning", (provider) => {
  it("is turned off only where a recording shows the provider accepts it", async () => {
    const accepted =
      REASONING_PROBED.some((probed) => probed === provider) &&
      loadRecording(provider, "reasoning-off").exchanges.every(
        ({ response }) => response.status === 200,
      );
    serve(reply(200, completion(WATER)));
    answer(await settle(ask(provider, {})));
    if (accepted) {
      expect(bodyOf(callAt(0))).toHaveProperty("reasoning_effort", "none");
    } else {
      expect(bodyOf(callAt(0))).not.toHaveProperty("reasoning_effort");
    }
  });
});

describe.each(CLOUD)("recorded %s wrong key", (provider) => {
  it("is reported with the provider's message", async () => {
    replay(loadRecording(provider, "unauthorized"));
    const error = failure(await settle(ask(provider, {})));
    expect(error).toMatchObject({ kind: "auth", status: 401 });
    expect(error.message).not.toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe("recorded Groq specifics", () => {
  it("retries a rate limit after 2 s then 8 s", async () => {
    replay(loadRecording("groq", "rate-limited"));
    const error = failure(await settle(ask("groq", {})));
    expect(error).toMatchObject({ kind: "rate-limited", status: 429 });
    expect(calls.map((call) => call.at)).toEqual([0, 2_000, 10_000]);
  });
});

describe("chat requests", () => {
  it("sends only Content-Type and Authorization", async () => {
    serve(reply(200, completion(WATER)));
    answer(await settle(ask("groq", {})));
    expect(callAt(0).url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(callAt(0).init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer test-key",
    });
  });

  it("sends no Authorization without a key", async () => {
    serve(reply(200, completion(WATER)));
    answer(await settle(ask("local", { endpoint: endpoint("local", null) })));
    expect(callAt(0).init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("lists models with a GET that carries only the key", async () => {
    serve(reply(200, { data: [{ id: "a" }, { id: "b" }] }));
    const ids = answer(
      await settle(listModels(endpoint("mistral", "k"), new AbortController().signal)),
    );
    expect(ids).toEqual(["a", "b"]);
    expect(callAt(0).init).toMatchObject({
      method: "GET",
      body: null,
      headers: { Authorization: "Bearer k" },
    });
  });

  it("asks for strict json_schema without the $schema keyword", async () => {
    serve(reply(200, completion(WATER)));
    answer(await settle(ask("mistral", {})));
    const body = bodyOf(callAt(0));
    expect(body).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: { name: "answer", strict: true, schema: { type: "object" } },
      },
    });
    expect(body).not.toHaveProperty(["response_format", "json_schema", "schema", "$schema"]);
    expect(body).not.toHaveProperty("provider");
  });

  it("asks OpenRouter to route only to endpoints with every parameter", async () => {
    serve(reply(200, completion(WATER)));
    answer(await settle(ask("openrouter", {})));
    expect(bodyOf(callAt(0))).toMatchObject({ provider: { require_parameters: true } });
  });

  it("starts in json_object with the schema in the system prompt when remembered", async () => {
    serve(reply(200, completion(WATER)));
    const result = answer(await settle(ask("groq", { mode: "json_object" })));
    expect(result.mode).toBe("json_object");
    const body = bodyOf(callAt(0));
    expect(body).toMatchObject({ response_format: { type: "json_object" } });
    expect(body).toHaveProperty(
      ["messages", 0, "content"],
      expect.stringContaining('"required":["word","pinyin","meaning"]'),
    );
    expect(body).toHaveProperty(["messages", "length"], RECORDING_MESSAGES.length);
  });

  it("adds a system message for the schema when there is none", async () => {
    serve(reply(200, completion(WATER)));
    const messages = [{ role: "user", content: "Water?" }] as const;
    answer(await settle(ask("groq", { mode: "json_object", messages })));
    expect(bodyOf(callAt(0))).toHaveProperty(["messages", 0, "role"], "system");
    expect(bodyOf(callAt(0))).toHaveProperty(["messages", 1], messages[0]);
  });

  // No model of Groq's free plan refuses strict json_schema (2026-10-19): a 400 in its shape, no code.
  it("falls back to json_object with the schema in the prompt when json_schema is refused", async () => {
    serve(
      reply(400, {
        error: { message: "json_schema is not supported", type: "invalid_request_error" },
      }),
      reply(200, completion(WATER)),
    );
    const result = answer(await settle(ask("groq", {})));
    expect(result.mode).toBe("json_object");
    expect(calls).toHaveLength(2);
    expect(bodyOf(callAt(1))).toMatchObject({ response_format: { type: "json_object" } });
    expect(bodyOf(callAt(1))).toHaveProperty(
      ["messages", 0, "content"],
      expect.stringContaining("JSON Schema"),
    );
  });

  it("does not fall back on a 400 it can name", async () => {
    serve(
      reply(400, {
        error: {
          message: "Too long",
          type: "invalid_request_error",
          code: "context_length_exceeded",
        },
      }),
    );
    expect(failure(await settle(ask("groq", {})))).toMatchObject({
      kind: "too-large",
      status: 400,
    });
    expect(calls).toHaveLength(1);
  });
});

describe("chat answers", () => {
  it("rejects a body that is not JSON", async () => {
    serve(reply(200, "<html>proxy</html>"));
    expect(failure(await settle(ask("local", {}))).kind).toBe("invalid-response");
  });

  it("rejects an empty choice list", async () => {
    serve(reply(200, { choices: [] }));
    expect(failure(await settle(ask("local", {}))).kind).toBe("invalid-response");
  });

  it("rejects a choice without content", async () => {
    serve(reply(200, completion(null)));
    expect(failure(await settle(ask("local", {}))).kind).toBe("invalid-response");
  });

  it("rejects content that is not JSON", async () => {
    serve(reply(200, completion("水 (shuǐ): water")));
    expect(failure(await settle(ask("local", {}))).kind).toBe("invalid-response");
  });
});

describe("chat errors", () => {
  it("retries a server error and returns the answer", async () => {
    serve(
      reply(503, { error: { message: "Overloaded", type: "server_error", code: null } }),
      reply(200, completion(WATER)),
    );
    answer(await settle(ask("groq", {})));
    expect(calls.map((call) => call.at)).toEqual([0, 2_000]);
  });

  it("keeps the status of a body it cannot read", async () => {
    serve(reply(502, "<html>Bad gateway</html>"));
    const error = failure(await settle(ask("mistral", {})));
    expect(error).toEqual({ kind: "server", status: 502, message: null });
    expect(calls).toHaveLength(3);
  });

  it("does not retry an exhausted quota", async () => {
    serve(
      reply(429, {
        error: {
          message: "Quota exceeded",
          type: "insufficient_quota",
          code: "insufficient_quota",
        },
      }),
    );
    expect(failure(await settle(ask("groq", {})))).toMatchObject({ kind: "quota", status: 429 });
    expect(calls).toHaveLength(1);
  });

  it("reads Mistral's documented error shape", async () => {
    serve(
      reply(400, {
        object: "error",
        message: "Invalid model: x",
        type: "invalid_model",
        param: null,
        code: "1500",
      }),
    );
    expect(failure(await settle(ask("mistral", {})))).toEqual({
      kind: "model-not-found",
      status: 400,
      message: "Invalid model: x",
    });
  });

  // Shape from OpenRouter's errors docs: none came up while recording on 2026-10-19.
  it("reads OpenRouter's error inside a 200 by its own code, and retries it", async () => {
    serve(
      reply(200, {
        error: {
          code: 502,
          message: "Provider returned error",
          metadata: { error_type: "provider_unavailable" },
        },
      }),
    );
    expect(failure(await settle(ask("openrouter", {})))).toEqual({
      kind: "server",
      status: 502,
      message: "Provider returned error",
    });
    expect(calls).toHaveLength(3);
  });

  it("reports a failed fetch as a network error", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    expect(failure(await settle(ask("local", {})))).toEqual({
      kind: "network",
      status: null,
      message: null,
    });
  });

  it("ends a call after 60 s, retries included, as a timeout", async () => {
    serve(reply(503, "busy", 20_000));
    expect(failure(await settle(ask("groq", {}))).kind).toBe("timeout");
    expect(calls.map((call) => call.at)).toEqual([0, 22_000, 50_000]);
  });

  it("returns the last error rather than wait past the 60 s", async () => {
    serve(reply(503, "busy", 25_000));
    expect(failure(await settle(ask("groq", {})))).toMatchObject({ kind: "server", status: 503 });
    expect(calls.map((call) => call.at)).toEqual([0, 27_000]);
  });

  it("reports a call the caller aborted", async () => {
    serve(reply(200, completion(WATER), Number.POSITIVE_INFINITY));
    const controller = new AbortController();
    const pending = ask("groq", { signal: controller.signal });
    controller.abort();
    expect(failure(await settle(pending)).kind).toBe("aborted");
  });
});
