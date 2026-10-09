import { describe, expect, it } from "vitest";
import { readingKey } from "./pinyin.ts";
import { loadCedictRows, loadCfdictRows } from "./testing/dataset-shards.ts";

describe("CFDICT join", () => {
  it("every French entry matches a CC-CEDICT entry", async () => {
    const keys = new Set<string>();
    for (const [simplified, , reading] of await loadCedictRows()) {
      const key = readingKey(reading);
      if (key.ok) keys.add(`${simplified}\t${key.value}`);
    }
    const french = await loadCfdictRows();
    expect(french.length).toBeGreaterThan(40_000);
    const orphans = french.filter(([simplified, key]) => !keys.has(`${simplified}\t${key}`));
    expect(orphans.slice(0, 10)).toEqual([]);
  });
});
