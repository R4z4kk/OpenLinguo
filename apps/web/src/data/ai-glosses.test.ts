import "fake-indexeddb/auto";
import { AI_BASE_URLS, inMemoryDictionary, ok, type DictEntry } from "@openlinguo/core";
import { createZhPack } from "@openlinguo/lang-zh";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import groqUnauthorized from "../../../../packages/core/src/testing/ai-responses/groq/unauthorized.json?raw";
import {
  deleteAiGloss,
  glossInput,
  loadAiGloss,
  translateEntry,
  withAiGlosses,
} from "./ai-glosses.ts";
import {
  DEFAULT_AI_SETTINGS,
  loadAiSettings,
  saveAiSettings,
  type AiConnection,
} from "./ai-settings.ts";
import { openDatabase, type Database, type StoredAiGloss } from "./database.ts";

const prompts = createZhPack({
  lookup: inMemoryDictionary([]),
  lexicon: new Set(),
  proficiency: "hsk-2025",
  decompositions: new Map(),
  strokesOf: () => Promise.resolve(ok(null)),
  wordsOfPinyin: () => Promise.resolve(ok([])),
}).prompts;
if (prompts === null) throw new Error("the zh pack has no prompts");
const task = prompts.glossTranslation;

const KEY = "gsk_test-key-for-translations";
const NOW = new Date("2026-10-19T15:20:00.000Z");
const WORD = { headword: "一路平安", readingKey: "yi1 lu4 ping2 an1" };

const ENTRY: DictEntry = {
  headword: "一路平安",
  variants: [],
  reading: "yi1 lu4 ping2 an1",
  glosses: [
    { lang: "en", text: "to have a pleasant journey", source: "cc-cedict" },
    { lang: "en", text: "Bon voyage!", source: "cc-cedict" },
  ],
  level: 2,
};
const INPUT = glossInput(ENTRY);

const GROQ: AiConnection = {
  endpoint: { provider: "groq", baseUrl: AI_BASE_URLS.groq, key: KEY },
  model: "openai/gpt-oss-20b",
  mode: "json_schema",
};

const STORED: StoredAiGloss = {
  id: "一路平安\tyi1 lu4 ping2 an1",
  ...WORD,
  senses: [
    { english: "to have a pleasant journey", french: "faire bon voyage" },
    { english: "Bon voyage!", french: "Bon voyage !" },
  ],
  provenance: {
    origin: "ai",
    provider: "groq",
    model: "openai/gpt-oss-20b",
    promptVersion: "zh-gloss-fr-v1",
    createdAt: NOW.toISOString(),
  },
};

/** Groq's real answer to a wrong key. */
const REFUSED = z
  .object({
    exchanges: z.tuple(
      [z.object({ response: z.object({ status: z.number(), body: z.unknown() }) })],
      z.unknown(),
    ),
  })
  .parse(JSON.parse(groqUnauthorized)).exchanges[0].response;

const Sent = z.object({ messages: z.array(z.object({ role: z.string(), content: z.string() })) });

/** Answers every request with `body`, and returns what was sent. */
const answer = (status: number, body: unknown): unknown[] => {
  const sent: unknown[] = [];
  vi.stubGlobal("fetch", (_input: string, init: RequestInit) => {
    sent.push(JSON.parse(z.string().parse(init.body)));
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  });
  return sent;
};

const completion = (content: unknown) => ({
  choices: [{ message: { role: "assistant", content: JSON.stringify(content) } }],
});

const translate = (connection: AiConnection) => {
  if (INPUT === null) throw new Error("一路平安 has no input");
  return translateEntry(db, connection, task, WORD, INPUT, new AbortController().signal, NOW);
};

let db: Database;
let counter = 0;

beforeEach(() => {
  counter += 1;
  db = openDatabase(`ai-glosses-test-${String(counter)}`);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("glossInput", () => {
  it("sends the headword, its reading and its English senses, classifiers left out", () => {
    const entry: DictEntry = {
      ...ENTRY,
      glosses: [...ENTRY.glosses, { lang: "en", text: "CL:次[ci4]", source: "cc-cedict" }],
    };
    expect(glossInput(entry)).toEqual({
      headword: "一路平安",
      reading: "yi1 lu4 ping2 an1",
      glosses: ["to have a pleasant journey", "Bon voyage!"],
    });
  });

  it("is null for an entry with a French gloss, no reading or no English sense", () => {
    const french = { lang: "fr", text: "bon voyage", source: "cfdict" } as const;
    expect(glossInput({ ...ENTRY, glosses: [...ENTRY.glosses, french] })).toBeNull();
    expect(glossInput({ ...ENTRY, reading: null })).toBeNull();
    expect(glossInput({ ...ENTRY, glosses: [] })).toBeNull();
  });
});

describe("translateEntry", () => {
  it("stores one French gloss per English sense with its provenance", async () => {
    const sent = answer(200, completion({ glosses: ["faire bon voyage", "Bon voyage !"] }));
    expect(await translate(GROQ)).toEqual(ok(STORED));
    expect(await loadAiGloss(db, WORD)).toEqual(ok(STORED));
    expect(sent).toHaveLength(1);
    const user = Sent.parse(sent[0]).messages.at(-1)?.content ?? "";
    expect(JSON.parse(user)).toEqual({
      headword: "一路平安",
      pinyin: "yi1 lu4 ping2 an1",
      senses: ["to have a pleasant journey", "Bon voyage!"],
    });
  });

  it("stores nothing when the provider refuses the key", async () => {
    answer(REFUSED.status, REFUSED.body);
    const result = await translate(GROQ);
    expect(result.ok ? null : result.error).toMatchObject({ kind: "ai", error: { kind: "auth" } });
    expect(await loadAiGloss(db, WORD)).toEqual(ok(null));
  });

  it("stores nothing when the answer does not have one gloss per sense", async () => {
    answer(200, completion({ glosses: ["bon voyage"] }));
    const result = await translate(GROQ);
    expect(result.ok ? null : result.error).toMatchObject({
      kind: "ai",
      error: { kind: "invalid-response" },
    });
    expect(await db.aiGlosses.count()).toBe(0);
  });

  it("reports a storage failure", async () => {
    answer(200, completion({ glosses: ["faire bon voyage", "Bon voyage !"] }));
    vi.spyOn(db.aiGlosses, "put").mockRejectedValueOnce(new Error("QuotaExceededError"));
    expect(await translate(GROQ)).toEqual({
      ok: false,
      error: { kind: "storage", error: { kind: "storage", message: "Error: QuotaExceededError" } },
    });
  });

  it("keeps the structured-output mode the model answered in", async () => {
    await saveAiSettings(db, {
      ...DEFAULT_AI_SETTINGS,
      provider: "groq",
      key: { provider: "groq", value: KEY },
      model: { provider: "groq", id: GROQ.model, mode: "json_schema" },
    });
    vi.stubGlobal("fetch", (_input: string, init: RequestInit) => {
      const body = z
        .object({ response_format: z.object({ type: z.string() }) })
        .parse(JSON.parse(z.string().parse(init.body)));
      return Promise.resolve(
        body.response_format.type === "json_schema"
          ? new Response(
              JSON.stringify({ error: { message: "This model does not support json_schema" } }),
              { status: 400 },
            )
          : new Response(
              JSON.stringify(completion({ glosses: ["faire bon voyage", "Bon voyage !"] })),
            ),
      );
    });
    expect((await translate(GROQ)).ok).toBe(true);
    const settings = await loadAiSettings(db);
    expect(settings.ok ? settings.value.model?.mode : null).toBe("json_object");
  });
});

describe("deleteAiGloss", () => {
  it("removes the translation, so it can be asked again", async () => {
    await db.aiGlosses.put(STORED);
    expect(await deleteAiGloss(db, WORD)).toEqual(ok(null));
    expect(await loadAiGloss(db, WORD)).toEqual(ok(null));
  });
});

describe("withAiGlosses", () => {
  it("adds the French glosses, marked as AI", () => {
    expect(withAiGlosses(ENTRY, STORED).glosses.slice(2)).toEqual([
      { lang: "fr", text: "faire bon voyage", source: "ai" },
      { lang: "fr", text: "Bon voyage !", source: "ai" },
    ]);
    expect(withAiGlosses(ENTRY, null)).toBe(ENTRY);
  });

  it("leaves an entry that has gained a French gloss as it is", () => {
    const entry: DictEntry = {
      ...ENTRY,
      glosses: [...ENTRY.glosses, { lang: "fr", text: "bon voyage", source: "cfdict" }],
    };
    expect(withAiGlosses(entry, STORED)).toBe(entry);
  });
});
