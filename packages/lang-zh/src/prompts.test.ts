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

  it("asks for every sentence by its index, the correct ones too", () => {
    const system = contentOf(prompts.correction.messages(correction), 0);
    expect(system).toContain("numbered from 1 to 2");
    expect(system).toContain("Answer exactly 2 items");
    expect(system).toContain("a correct sentence too");
  });

  it("asks for the changes before the corrected sentence", () => {
    const schema = z.toJSONSchema(prompts.correction.schema(correction));
    const item = z
      .object({
        properties: z.object({
          sentences: z.object({
            items: z.object({ properties: z.record(z.string(), z.unknown()) }),
          }),
        }),
      })
      .parse(schema).properties.sentences.items.properties;
    expect(Object.keys(item)).toEqual(["index", "changes", "corrected", "reading", "meaning"]);
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

const explain = {
  sequences: [
    { sequence: "王芳", sentence: "我的同学王芳去张家界玩了。" },
    { sequence: "红白机", sentence: "我们还要玩红白机。" },
    { sequence: "袁家界拍", sentence: "她们在袁家界拍了很多照片。" },
  ],
  language: "fr",
} as const;

const explained = (index: number, kind: string, meaning: string) => ({ index, kind, meaning });

// Hand-made, until a recorded answer replaces it.
const handMadeExplanation = {
  sequences: [
    explained(3, "not-a-word", ""),
    explained(1, "person", "Nom de personne chinois."),
    explained(2, "word", "Console de jeu japonaise (Famicom)."),
  ],
};

describe("explanation prompt", () => {
  it("asks for a kind and a short meaning, in the interface language", () => {
    const system = contentOf(prompts.explanation.messages(explain), 0);
    for (const kind of ["person", "place", "organization", "word", "not-a-word"]) {
      expect(system).toContain(`"${kind}"`);
    }
    expect(system).toContain("in French");
    expect(contentOf(prompts.explanation.messages({ ...explain, language: "en" }), 0)).toContain(
      "in English",
    );
  });

  it("asks for every sequence by its index", () => {
    const system = contentOf(prompts.explanation.messages(explain), 0);
    expect(system).toContain("numbered from 1 to 3");
    expect(system).toContain("Answer exactly 3 items");
  });

  it("sends the numbered sequences with their sentences as data", () => {
    const user = contentOf(prompts.explanation.messages(explain), 1);
    expect(JSON.parse(user)).toEqual({
      sequences: explain.sequences.map((item, at) => ({ index: at + 1, ...item })),
    });
  });

  it("asks for the kind before the meaning", () => {
    const schema = z.toJSONSchema(prompts.explanation.schema(explain));
    const item = z
      .object({
        properties: z.object({
          sequences: z.object({
            items: z.object({ properties: z.record(z.string(), z.unknown()) }),
          }),
        }),
      })
      .parse(schema).properties.sequences.items.properties;
    expect(Object.keys(item)).toEqual(["index", "kind", "meaning"]);
  });

  it("round-trips a valid answer, in any order", () => {
    expect(prompts.explanation.schema(explain).parse(handMadeExplanation)).toEqual(
      handMadeExplanation,
    );
  });

  it("rejects a missing or an extra sequence", () => {
    const schema = prompts.explanation.schema(explain);
    const [first, second, third] = handMadeExplanation.sequences;
    expect(schema.safeParse({ sequences: [first, second] }).success).toBe(false);
    expect(schema.safeParse({ sequences: [] }).success).toBe(false);
    expect(
      schema.safeParse({ sequences: [first, second, third, explained(1, "word", "Un mot.")] })
        .success,
    ).toBe(false);
  });

  it("rejects an index missing, repeated or out of range", () => {
    const schema = prompts.explanation.schema(explain);
    const indexed = (...indices: number[]) => ({
      sequences: indices.map((index) => explained(index, "word", "Un mot.")),
    });
    expect(schema.safeParse(indexed(3, 1, 2)).success).toBe(true);
    expect(schema.safeParse(indexed(1, 1, 2)).success).toBe(false);
    expect(schema.safeParse(indexed(0, 1, 2)).success).toBe(false);
    expect(schema.safeParse(indexed(1, 2, 4)).success).toBe(false);
    expect(schema.safeParse(indexed(1, 2, 2.5)).success).toBe(false);
    const unindexed = { kind: "word", meaning: "Un mot." };
    expect(
      schema.safeParse({ sequences: [unindexed, ...handMadeExplanation.sequences.slice(1)] })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown kind, a missing key or an empty meaning but for not-a-word", () => {
    const schema = prompts.explanation.schema(explain);
    const answered = (second: unknown) => ({
      sequences: [explained(1, "person", "Nom."), second, explained(3, "not-a-word", "")],
    });
    expect(schema.safeParse(answered(explained(2, "word", "Un mot."))).success).toBe(true);
    expect(schema.safeParse(answered(explained(2, "other", "Un mot."))).success).toBe(false);
    expect(schema.safeParse(answered({ index: 2, meaning: "Un mot." })).success).toBe(false);
    expect(schema.safeParse(answered({ index: 2, kind: "word" })).success).toBe(false);
    expect(schema.safeParse(answered(explained(2, "word", " "))).success).toBe(false);
    expect(schema.safeParse(answered(explained(2, "place", ""))).success).toBe(false);
  });

  it("rejects a meaning too long to be very short text", () => {
    const schema = prompts.explanation.schema({ ...explain, sequences: [explain.sequences[0]] });
    const meaning = (length: number) => ({ sequences: [explained(1, "word", "a".repeat(length))] });
    expect(schema.safeParse(meaning(200)).success).toBe(true);
    expect(schema.safeParse(meaning(201)).success).toBe(false);
  });
});

const storyInput = { band: 2, theme: "travel", length: "medium", words: ["旅游", "照片"] } as const;

// Hand-made, until a recorded answer replaces it.
const handMadeStory = {
  title: "小花和大雨",
  paragraphs: ["小花想去公园玩。", "天气不好，下大雨了。"],
  names: [{ text: "小花", kind: "person" }],
};

describe("story prompt", () => {
  it("asks for simplified characters at the learner's level", () => {
    const system = contentOf(prompts.story.messages(storyInput), 0);
    expect(system).toContain("simplified characters");
    expect(system).toContain("level 2 of the HSK 2025 exam");
  });

  it("asks for about 150 characters when short and 400 when medium", () => {
    expect(contentOf(prompts.story.messages(storyInput), 0)).toContain("about 400");
    expect(contentOf(prompts.story.messages({ ...storyInput, length: "short" }), 0)).toContain(
      "about 150",
    );
  });

  it("asks for plausible names only", () => {
    expect(contentOf(prompts.story.messages(storyInput), 0)).toContain("plausible");
  });

  it("sends the theme and the words as data", () => {
    expect(JSON.parse(contentOf(prompts.story.messages(storyInput), 1))).toEqual({
      theme: "travel",
      words: ["旅游", "照片"],
    });
  });

  it("round-trips a valid story, with or without names", () => {
    const schema = prompts.story.schema(storyInput);
    expect(schema.parse(handMadeStory)).toEqual(handMadeStory);
    expect(schema.safeParse({ ...handMadeStory, names: [] }).success).toBe(true);
  });

  it("rejects paragraphs that are empty, blank or not an array", () => {
    const schema = prompts.story.schema(storyInput);
    expect(schema.safeParse({ ...handMadeStory, paragraphs: [] }).success).toBe(false);
    expect(schema.safeParse({ ...handMadeStory, paragraphs: "小花想去公园玩。" }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ ...handMadeStory, paragraphs: ["小花想去公园玩。", " "] }).success,
    ).toBe(false);
    const { title, names } = handMadeStory;
    expect(schema.safeParse({ title, names }).success).toBe(false);
  });

  it("rejects an empty title", () => {
    const schema = prompts.story.schema(storyInput);
    expect(schema.safeParse({ ...handMadeStory, title: "" }).success).toBe(false);
    expect(schema.safeParse({ ...handMadeStory, title: "  " }).success).toBe(false);
  });

  it("rejects a title or a paragraph with no Chinese character", () => {
    const schema = prompts.story.schema(storyInput);
    expect(schema.safeParse({ ...handMadeStory, title: "Rain" }).success).toBe(false);
    expect(
      schema.safeParse({ ...handMadeStory, paragraphs: ["Xiao Hua wants to go to the park."] })
        .success,
    ).toBe(false);
  });

  it("rejects a name that is empty or not a person, a place or an organization", () => {
    const schema = prompts.story.schema(storyInput);
    const named = (...names: unknown[]) => ({ ...handMadeStory, names });
    for (const kind of ["person", "place", "organization"]) {
      expect(schema.safeParse(named({ text: "北京", kind })).success).toBe(true);
    }
    expect(schema.safeParse(named({ text: "北京", kind: "word" })).success).toBe(false);
    expect(schema.safeParse(named({ text: "北京", kind: "not-a-word" })).success).toBe(false);
    expect(schema.safeParse(named({ text: " ", kind: "place" })).success).toBe(false);
    expect(schema.safeParse(named({ text: "北京" })).success).toBe(false);
    expect(schema.safeParse(named({ kind: "place" })).success).toBe(false);
    const { title, paragraphs } = handMadeStory;
    expect(schema.safeParse({ title, paragraphs }).success).toBe(false);
  });
});

describe("answer schemas", () => {
  it("convert to JSON schemas with no keyword strict structured output may refuse", () => {
    const schemas = [
      prompts.correction.schema(correction),
      prompts.vocabulary.schema({ themes: [], note: "", level: 1, count: 3 }),
      prompts.glossTranslation.schema({ headword: "好", reading: "hao3", glosses: ["good"] }),
      prompts.explanation.schema(explain),
      prompts.story.schema(storyInput),
    ];
    for (const schema of schemas) {
      expect(JSON.stringify(z.toJSONSchema(schema))).not.toMatch(
        /minLength|maxLength|minimum|maximum|pattern|minItems|maxItems|format/u,
      );
    }
  });
});
