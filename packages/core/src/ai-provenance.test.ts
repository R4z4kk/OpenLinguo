import { describe, expect, it } from "vitest";
import { AiProvenance } from "./ai-provenance.ts";
import { parseWith } from "./validation.ts";

const PROVENANCE: AiProvenance = {
  origin: "ai",
  provider: "local",
  model: "qwen3:30b-a3b",
  promptVersion: "zh-correct-v1",
  createdAt: "2026-10-19T14:03:27.512Z",
};

describe("AiProvenance", () => {
  it("accepts the example of the specification", () => {
    expect(parseWith(AiProvenance, PROVENANCE)).toEqual({ ok: true, value: PROVENANCE });
  });

  it("drops any other member, so no learner data is kept", () => {
    const parsed = parseWith(AiProvenance, {
      ...PROVENANCE,
      learner: "Ana",
      key: "gsk_secret",
      baseUrl: "http://localhost:11434/v1",
      prompt: "Corrige : 我电话很新。",
    });
    expect(parsed).toEqual({ ok: true, value: PROVENANCE });
  });

  it("refuses another origin, an unknown provider, empty ids and dates outside UTC", () => {
    const parsed = parseWith(AiProvenance, {
      origin: "human",
      provider: "gemini",
      model: "",
      promptVersion: "",
      createdAt: "2026-10-19T16:03:27+02:00",
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.issues.map((issue) => issue.path)).toEqual([
      "origin",
      "provider",
      "model",
      "promptVersion",
      "createdAt",
    ]);
  });
});
