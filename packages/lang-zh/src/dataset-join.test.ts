import { beforeAll, describe, expect, it } from "vitest";
import { readingKey, toDiacritic } from "./pinyin.ts";
import { loadCedictRows, loadCfdictEntries, loadCfdictGlosses } from "./testing/dataset-shards.ts";

describe("CFDICT data", () => {
  const keys = new Set<string>();

  beforeAll(async () => {
    for (const [simplified, , reading] of await loadCedictRows()) {
      const key = readingKey(reading);
      if (key.ok) keys.add(`${simplified}\t${key.value}`);
    }
  });

  it("glosses only existing CC-CEDICT entries", async () => {
    const glosses = await loadCfdictGlosses();
    expect(glosses.length).toBeGreaterThan(40_000);
    const orphans = glosses.filter(([simplified, key]) => !keys.has(`${simplified}\t${key}`));
    expect(orphans.slice(0, 10)).toEqual([]);
  });

  it("adds French-only entries with valid readings that CC-CEDICT does not have", async () => {
    const entries = await loadCfdictEntries();
    expect(entries.length).toBeGreaterThan(5_000);
    const invalid = entries.filter(([, , reading]) => !toDiacritic(reading).ok);
    expect(invalid.slice(0, 10)).toEqual([]);
    const duplicates = entries.filter(([simplified, , reading]) => {
      const key = readingKey(reading);
      return key.ok && keys.has(`${simplified}\t${key.value}`);
    });
    expect(duplicates.slice(0, 10)).toEqual([]);
  });
});
