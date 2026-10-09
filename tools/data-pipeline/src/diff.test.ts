import { describe, expect, it } from "vitest";
import { diffRows } from "./diff.ts";
import { toShards } from "./shards.ts";

const shards = (rows: readonly (readonly string[])[], size: number): string[] => [
  ...toShards("entries", rows, size).values(),
];

describe("diffRows", () => {
  const rows = [["a"], ["b"], ["c"], ["d"]];

  it("reports no change when rows only move across shard boundaries", () => {
    expect(diffRows(shards(rows, 2), shards(rows, 3))).toEqual({ added: 0, removed: 0 });
  });

  it("counts added and removed rows", () => {
    const next = [["a"], ["c"], ["d"], ["e"], ["f"]];
    expect(diffRows(shards(rows, 2), shards(next, 2))).toEqual({ added: 2, removed: 1 });
  });

  it("counts a changed row as one removal and one addition", () => {
    const next = [["a"], ["b", "x"], ["c"], ["d"]];
    expect(diffRows(shards(rows, 2), shards(next, 2))).toEqual({ added: 1, removed: 1 });
  });

  it("treats a first import as all additions", () => {
    expect(diffRows([], shards(rows, 2))).toEqual({ added: 4, removed: 0 });
  });

  it("keeps duplicate rows distinct", () => {
    expect(diffRows(shards([["a"]], 2), shards([["a"], ["a"]], 2))).toEqual({
      added: 1,
      removed: 0,
    });
  });
});
