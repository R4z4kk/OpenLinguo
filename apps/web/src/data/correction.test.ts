import { createPrompts } from "@openlinguo/lang-zh";
import { ok } from "@openlinguo/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { rewriteItems, type AnswerItem } from "../../e2e/ai-replay.ts";
import recorded from "../../e2e/fixtures/ai/local-correction.json?raw";
import type { AiConnection } from "./ai-settings.ts";
import {
  currentCorrections,
  diffChars,
  isCorrected,
  readingSyllables,
  requestCorrection,
  type SentenceCorrection,
} from "./correction.ts";

const SENTENCES = [
  "我给妈妈打电话。",
  "你的电话号码是多少？",
  "我电话很新。",
  "晚上我不想接电话。",
  "请你电话我。",
];

const correction = createPrompts({
  lookup: () => Promise.resolve(ok([])),
  tokenize: () => [],
  proficiency: "hsk-2025",
}).correction;

const LOCAL: AiConnection = {
  endpoint: { provider: "local", baseUrl: "http://localhost:11434/v1", key: null },
  model: "qwen3:30b-a3b",
  mode: "json_schema",
};

/** The recorded answer of qwen3:30b-a3b to SENTENCES, its items rewritten. */
const answering = (rewrite: (items: readonly AnswerItem[]) => readonly AnswerItem[]): void => {
  const { exchanges } = z
    .object({ exchanges: z.array(z.object({ response: z.object({ body: z.unknown() }) })) })
    .parse(JSON.parse(recorded));
  const body = rewriteItems(exchanges.at(-1)?.response.body ?? null, rewrite);
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify(body))));
};

const correct = () =>
  requestCorrection(LOCAL, correction, "电话", SENTENCES, "en", new AbortController().signal);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("diffChars", () => {
  it("marks an insertion", () => {
    expect(diffChars("我电话很新。", "我的电话很新。")).toEqual([
      { kind: "same", text: "我" },
      { kind: "added", text: "的" },
      { kind: "same", text: "电话很新。" },
    ]);
  });

  it("marks a deletion", () => {
    expect(diffChars("我很很好。", "我很好。")).toEqual([
      { kind: "same", text: "我很" },
      { kind: "removed", text: "很" },
      { kind: "same", text: "好。" },
    ]);
  });

  it("marks a substitution as a removal, then the insertion", () => {
    expect(diffChars("他在学校。", "她在学校。")).toEqual([
      { kind: "removed", text: "他" },
      { kind: "added", text: "她" },
      { kind: "same", text: "在学校。" },
    ]);
  });

  it("keeps characters outside the basic plane whole", () => {
    expect(diffChars("𠀀好", "𠀁好")).toEqual([
      { kind: "removed", text: "𠀀" },
      { kind: "added", text: "𠀁" },
      { kind: "same", text: "好" },
    ]);
  });

  it("leaves an unchanged sentence in one part", () => {
    expect(diffChars("你好。", "你好。")).toEqual([{ kind: "same", text: "你好。" }]);
    expect(diffChars("", "")).toEqual([]);
  });
});

describe("requestCorrection", () => {
  it("sends the filled fields only, numbered, and gives each field its correction and provenance", async () => {
    const { exchanges } = z
      .object({ exchanges: z.array(z.object({ response: z.object({ body: z.unknown() }) })) })
      .parse(JSON.parse(recorded));
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", (_input: string, init: RequestInit) => {
      sent.push(JSON.parse(typeof init.body === "string" ? init.body : ""));
      return Promise.resolve(new Response(JSON.stringify(exchanges.at(-1)?.response.body)));
    });
    const fields = [...SENTENCES.slice(0, 2), "  ", ...SENTENCES.slice(2)];
    const reply = await requestCorrection(
      LOCAL,
      correction,
      "电话",
      fields,
      "en",
      new AbortController().signal,
    );
    if (!reply.ok) throw new Error(reply.error.kind);
    expect(sent).toMatchObject([
      {
        messages: [
          { role: "system" },
          {
            content: JSON.stringify({
              word: "电话",
              sentences: SENTENCES.map((text, at) => ({ index: at + 1, text })),
            }),
          },
        ],
      },
    ]);
    const { corrections } = reply.value;
    expect(corrections.map((item) => item?.original ?? null)).toEqual([
      SENTENCES[0],
      SENTENCES[1],
      null,
      SENTENCES[2],
      SENTENCES[3],
      SENTENCES[4],
    ]);
    expect(corrections[3]).toMatchObject({
      corrected: "我的电话很新。",
      choice: null,
      provenance: {
        origin: "ai",
        provider: "local",
        model: "qwen3:30b-a3b",
        promptVersion: "zh-correct-v2",
      },
    });
    expect(corrections[3]).not.toHaveProperty("index");
  });

  it("matches answers by their index, in any order", async () => {
    // dots-3-note-preview on OpenRouter, 2026-10-20, put the corrected sentence first (#206).
    const withoutDate = async () => {
      const reply = await correct();
      if (!reply.ok) throw new Error(reply.error.kind);
      return reply.value.corrections.map((item) =>
        item === null ? null : { ...item, provenance: { ...item.provenance, createdAt: "" } },
      );
    };
    answering((items) => items);
    const inOrder = await withoutDate();
    answering((items) => [...items].reverse());
    expect(await withoutDate()).toEqual(inOrder);
    expect(inOrder.map((item) => item?.original ?? null)).toEqual(SENTENCES);
  });

  it("refuses an answer whose index names another sentence", async () => {
    answering((items) =>
      items.map((item) => ({
        ...item,
        index: item.index === 1 ? 3 : item.index === 3 ? 1 : item.index,
      })),
    );
    expect(await correct()).toEqual({
      ok: false,
      error: { kind: "invalid-response", status: null, message: null },
    });
  });
});

describe("currentCorrections", () => {
  const corrected = (original: string): SentenceCorrection => ({
    original,
    corrected: original,
    changes: [],
    reading: "",
    meaning: "",
    choice: null,
    provenance: {
      origin: "ai",
      provider: "local",
      model: "m",
      promptVersion: "zh-correct-v1",
      createdAt: "2026-10-19T20:00:00.000Z",
    },
  });

  it("drops a correction once its field has changed", () => {
    expect(
      currentCorrections(["你好。", "再见"], [corrected("你好。"), corrected("再见。")]),
    ).toEqual([corrected("你好。"), null]);
  });

  it("calls a challenge corrected when every filled field is", () => {
    expect(isCorrected(["你好。", ""], [corrected("你好。"), null])).toBe(true);
    expect(isCorrected(["你好。", "再见"], [corrected("你好。"), null])).toBe(false);
    expect(isCorrected(["", ""], [null, null])).toBe(false);
  });
});

describe("readingSyllables", () => {
  it("gives each Han character its syllable, words and punctuation aside, and its mismatch", () => {
    const mismatch = { start: 5, end: 6, written: "xin4", readings: ["xin1"] };
    expect(readingSyllables("我的电话很新。", "Wǒ de diànhuà hěn xìn.", [mismatch])).toEqual([
      { numbered: "Wo3", mismatch: null },
      { numbered: "de5", mismatch: null },
      { numbered: "dian4", mismatch: null },
      { numbered: "hua4", mismatch: null },
      { numbered: "hen3", mismatch: null },
      { numbered: "xin4", mismatch },
    ]);
  });

  it("gives nothing for a reading that does not follow the characters", () => {
    expect(readingSyllables("我的电话很新。", "wǒ de diànhuà", [])).toBeNull();
  });
});
