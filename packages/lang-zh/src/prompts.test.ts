import { inMemoryDictionary } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createPrompts } from "./prompts.ts";
import { createSegmenter } from "./segment.ts";

const prompts = createPrompts({
  lookup: inMemoryDictionary([]),
  tokenize: createSegmenter(new Set()),
  proficiency: "hsk-2025",
});

const contentOf = (messages: readonly { readonly content: string }[], index: number): string =>
  messages[index]?.content ?? "";

const correction = {
  word: "电话",
  sentences: ["我打电话你。", "我很好。"],
  language: "fr",
} as const;

const sentence = (index: number, corrected: string) => ({
  index,
  corrected,
  changes: [],
  reading: "wǒ hěn hǎo",
  meaning: "Je vais bien.",
});

const answer = {
  sentences: [
    sentence(2, "我很好。"),
    {
      index: 1,
      corrected: "我给你打电话。",
      changes: [
        { from: "", to: "给你", explanation: "Le destinataire se place avant le verbe avec 给." },
        { from: "你", to: "", explanation: "« 打电话 » ne prend pas d'objet direct." },
      ],
      reading: "wǒ gěi nǐ dǎ diàn huà",
      meaning: "Je t'appelle.",
    },
  ],
};

describe("correction prompt", () => {
  it("asks for minimal fixes, explained in the interface language", () => {
    const system = contentOf(prompts.correction.messages(correction), 0);
    expect(system).toContain("smallest change");
    expect(system).toContain("never rewrite");
    expect(system).toContain("in French");
    expect(contentOf(prompts.correction.messages({ ...correction, language: "en" }), 0)).toContain(
      "in English",
    );
  });

  it("sends the word and the numbered sentences as data", () => {
    const numbered = [
      { index: 1, text: "我打电话你。" },
      { index: 2, text: "我很好。" },
    ];
    const user = contentOf(prompts.correction.messages(correction), 1);
    expect(JSON.parse(user)).toEqual({ word: "电话", sentences: numbered });
    const free = contentOf(prompts.correction.messages({ ...correction, word: null }), 1);
    expect(JSON.parse(free)).toEqual({ word: null, sentences: numbered });
  });

  it("round-trips a valid answer, in any order", () => {
    expect(prompts.correction.schema(correction).parse(answer)).toEqual(answer);
  });

  it("rejects a missing sentence, an empty field or a missing key", () => {
    const schema = prompts.correction.schema(correction);
    expect(schema.safeParse({ sentences: [sentence(1, "我很好。")] }).success).toBe(false);
    expect(
      schema.safeParse({ sentences: [sentence(1, " "), sentence(2, "我很好。")] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        sentences: [{ index: 1, corrected: "我很好。" }, sentence(2, "我很好。")],
      }).success,
    ).toBe(false);
  });

  it("rejects an index missing, repeated or out of range", () => {
    const schema = prompts.correction.schema(correction);
    const indexed = (...indices: number[]) => ({
      sentences: indices.map((index) => sentence(index, "我很好。")),
    });
    expect(schema.safeParse(indexed(2, 1)).success).toBe(true);
    expect(schema.safeParse(indexed(1, 1)).success).toBe(false);
    expect(schema.safeParse(indexed(0, 1)).success).toBe(false);
    expect(schema.safeParse(indexed(1, 3)).success).toBe(false);
    expect(schema.safeParse(indexed(1, 1.5)).success).toBe(false);
    const unindexed = {
      corrected: "我很好。",
      changes: [],
      reading: "wǒ hěn hǎo",
      meaning: "Bien.",
    };
    expect(schema.safeParse({ sentences: [unindexed, sentence(2, "我很好。")] }).success).toBe(
      false,
    );
  });
});

describe("vocabulary prompt", () => {
  const input = { themes: ["cuisine"], note: "je fais du vélo", level: 7, count: 2 };

  it("names the level, the framework and the count", () => {
    const system = contentOf(prompts.vocabulary.messages(input), 0);
    expect(system).toContain("level 7-9 of the HSK 2025 exam");
    expect(system).toContain("at most 2");
  });

  it("sends the themes and the note as data", () => {
    expect(JSON.parse(contentOf(prompts.vocabulary.messages(input), 1))).toEqual({
      themes: ["cuisine"],
      note: "je fais du vélo",
    });
  });

  it("keeps headwords only, at most the count asked", () => {
    const schema = prompts.vocabulary.schema(input);
    expect(schema.parse({ headwords: ["菜单", "自行车"] })).toEqual({
      headwords: ["菜单", "自行车"],
    });
    expect(schema.safeParse({ headwords: ["菜单"] }).success).toBe(true);
    expect(schema.safeParse({ headwords: ["菜单", "自行车", "饺子"] }).success).toBe(false);
    expect(schema.safeParse({ headwords: ["càidān"] }).success).toBe(false);
    expect(schema.safeParse({ headwords: ["菜单 (menu)"] }).success).toBe(false);
  });
});

describe("gloss translation prompt", () => {
  const input = { headword: "电话", reading: "dian4 hua4", glosses: ["telephone", "phone call"] };

  it("sends the entry as data", () => {
    expect(JSON.parse(contentOf(prompts.glossTranslation.messages(input), 1))).toEqual({
      headword: "电话",
      pinyin: "dian4 hua4",
      senses: ["telephone", "phone call"],
    });
  });

  it("wants one French gloss per English sense", () => {
    const schema = prompts.glossTranslation.schema(input);
    expect(schema.parse({ glosses: ["téléphone", "appel"] })).toEqual({
      glosses: ["téléphone", "appel"],
    });
    expect(schema.safeParse({ glosses: ["téléphone"] }).success).toBe(false);
    expect(schema.safeParse({ glosses: ["téléphone", ""] }).success).toBe(false);
  });
});

describe("answer schemas", () => {
  it("convert to JSON schemas with no keyword strict structured output may refuse", () => {
    const schemas = [
      prompts.correction.schema(correction),
      prompts.vocabulary.schema({ themes: [], note: "", level: 1, count: 3 }),
      prompts.glossTranslation.schema({ headword: "好", reading: "hao3", glosses: ["good"] }),
    ];
    for (const schema of schemas) {
      expect(JSON.stringify(z.toJSONSchema(schema))).not.toMatch(
        /minLength|maxLength|minimum|maximum|pattern|minItems|maxItems|format/u,
      );
    }
  });
});
