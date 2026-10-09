import { describe, expect, it } from "vitest";
import { formatProblem, freshnessProblems } from "./freshness.ts";
import type { ManifestEntry } from "./manifest.ts";

const entry = (retrievedAt: string): ManifestEntry => ({
  source: "https://example.org/a.txt",
  license: "CC-BY-SA-4.0",
  version: "v1",
  retrievedAt,
  maxAgeDays: 90,
  sha256: "a".repeat(64),
});

const now = new Date("2026-10-09T12:00:00Z");

describe("freshnessProblems", () => {
  it("accepts a dataset exactly at its max age", () => {
    expect(freshnessProblems({ a: entry("2026-07-11T12:00:00Z") }, now)).toEqual([]);
  });

  it("reports an expired dataset with its name and age", () => {
    const problems = freshnessProblems(
      { fresh: entry("2026-10-01T00:00:00Z"), old: entry("2026-07-01T00:00:00Z") },
      now,
    );
    expect(problems).toEqual([{ kind: "expired", dataset: "old", ageDays: 100, maxAgeDays: 90 }]);
    expect(problems.map(formatProblem)[0]).toContain("old: retrieved 100 days ago, max 90");
  });

  it("rejects a retrieval date in the future", () => {
    expect(freshnessProblems({ a: entry("2027-01-01T00:00:00Z") }, now)).toEqual([
      { kind: "future-date", dataset: "a", retrievedAt: "2027-01-01T00:00:00Z" },
    ]);
  });
});
