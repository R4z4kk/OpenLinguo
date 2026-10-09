import { describe, expect, it } from "vitest";
import { parseManifest, serializeManifest } from "./manifest.ts";

const entry = {
  source: "https://example.org/a.txt",
  license: "CC-BY-SA-4.0",
  version: "v1",
  retrievedAt: "2026-10-09T12:00:00.000Z",
  maxAgeDays: 90,
  sha256: "a".repeat(64),
};

describe("manifest", () => {
  it("round-trips with sorted dataset ids", () => {
    const json = serializeManifest({ zeta: entry, alpha: entry });
    expect(Object.keys(JSON.parse(json) as object)).toEqual(["alpha", "zeta"]);
    expect(parseManifest(json)).toEqual({ ok: true, value: { alpha: entry, zeta: entry } });
  });

  it("rejects entries with missing or invalid fields", () => {
    const result = parseManifest(JSON.stringify({ a: { ...entry, sha256: "xyz", maxAgeDays: 0 } }));
    expect(result.ok || result.error.kind).toBe("manifest-invalid");
  });

  it("rejects unknown fields", () => {
    expect(parseManifest(JSON.stringify({ a: { ...entry, extra: 1 } })).ok).toBe(false);
  });

  it("rejects malformed JSON", () => {
    expect(parseManifest("{").ok).toBe(false);
  });
});
