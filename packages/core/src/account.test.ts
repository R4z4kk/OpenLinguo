import { describe, expect, it } from "vitest";
import { AgeDeclaration } from "./account.ts";
import { parseWith } from "./validation.ts";

describe("AgeDeclaration", () => {
  it("accepts both answers", () => {
    for (const answer of ["15-or-over", "under-15"]) {
      expect(parseWith(AgeDeclaration, { answer })).toEqual({ ok: true, value: { answer } });
    }
  });

  it("refuses any other answer", () => {
    expect(parseWith(AgeDeclaration, { answer: "18" }).ok).toBe(false);
    expect(parseWith(AgeDeclaration, {}).ok).toBe(false);
  });
});
