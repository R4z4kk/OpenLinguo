import { describe, expect, it } from "vitest";
import { z } from "zod";
import { inMemoryDictionary, intlTokenizer } from "./dictionary.ts";
import type { LanguagePack, ToneFeature } from "./language-pack.ts";
import { hasFeatures, supportedModules } from "./module-registry.ts";
import type { PromptPack, PromptTask } from "./prompt-pack.ts";
import { ok } from "./result.ts";

const tones: ToneFeature = { tonesOf: () => ok([1]) };

const task: PromptTask<unknown, never> = {
  id: "test-v1",
  messages: () => [],
  schema: () => z.never(),
};

const prompts: PromptPack = {
  correction: task,
  vocabulary: task,
  glossTranslation: task,
  checkReading: () => Promise.resolve(ok([])),
};

const pack = (
  features: Partial<LanguagePack["features"]>,
  withPrompts: PromptPack | null = null,
): LanguagePack => ({
  id: "zh",
  proficiency: "hsk-2025",
  tokenize: intlTokenizer("zh-Hans"),
  lookup: inMemoryDictionary([]),
  features: {
    tones: null,
    strokes: null,
    romanization: null,
    decomposition: null,
    ime: null,
    ...features,
  },
  prompts: withPrompts,
});

const modules = [
  { id: "dictionary", requires: [] },
  { id: "tone-drill", requires: ["tones"] },
  { id: "writing", requires: ["strokes", "tones"] },
  { id: "journal", requires: ["prompts"] },
] as const;

describe("module registry", () => {
  it("keeps modules without requirements for any pack", () => {
    expect(supportedModules(pack({}), modules).map((m) => m.id)).toEqual(["dictionary"]);
  });

  it("keeps modules whose features are all present", () => {
    expect(supportedModules(pack({ tones }), modules).map((m) => m.id)).toEqual([
      "dictionary",
      "tone-drill",
    ]);
  });

  it("narrows the pack to non-null features", () => {
    const candidate = pack({ tones });
    expect(hasFeatures(candidate, ["tones"])).toBe(true);
    if (hasFeatures(candidate, ["tones"])) {
      expect(candidate.features.tones.tonesOf("ma1")).toEqual({ ok: true, value: [1] });
    }
  });

  it("rejects a pack missing one required feature", () => {
    expect(hasFeatures(pack({ tones }), ["tones", "strokes"])).toBe(false);
  });

  it("keeps modules that need prompts only for a pack with them", () => {
    expect(supportedModules(pack({}), modules).map((m) => m.id)).not.toContain("journal");
    expect(supportedModules(pack({}, prompts), modules).map((m) => m.id)).toContain("journal");
  });

  it("narrows the pack to non-null prompts", () => {
    const candidate = pack({ tones }, prompts);
    expect(hasFeatures(candidate, ["tones", "prompts"])).toBe(true);
    if (hasFeatures(candidate, ["tones", "prompts"])) {
      expect(candidate.prompts.correction.id).toBe("test-v1");
    }
  });
});
