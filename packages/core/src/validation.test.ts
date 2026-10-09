import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseWith } from "./validation.ts";

const Entry = z.object({
  hanzi: z.string().min(1),
  level: z.number().int().min(1).max(9),
});

describe("parseWith", () => {
  it("returns the parsed value on valid input", () => {
    expect(parseWith(Entry, { hanzi: "电话", level: 1 })).toEqual({
      ok: true,
      value: { hanzi: "电话", level: 1 },
    });
  });

  it("returns every issue with its path on invalid input", () => {
    const result = parseWith(Entry, { hanzi: "", level: 12 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    expect(result.error.issues.map((issue) => issue.path)).toEqual(["hanzi", "level"]);
  });

  it("rejects non-object input", () => {
    const result = parseWith(Entry, "not an entry");
    expect(result.ok).toBe(false);
  });
});
