import { beforeAll, describe, expect, it } from "vitest";
import { readingKey, toDiacritic } from "./pinyin.ts";
import {
  loadCedictRows,
  loadFrenchEntries,
  loadFrenchGlosses,
  loadGf0025Characters,
  loadGf0025Words,
  loadHskCharacters,
  loadHskWords,
} from "./testing/dataset-shards.ts";

describe.each([
  ["cfdict", 40_000, 5_000],
  ["wiktionary-fr-zh", 6_000, 1_000],
])("%s data", (dataset, minGlosses, minEntries) => {
  const keys = new Set<string>();

  beforeAll(async () => {
    for (const [simplified, , reading] of await loadCedictRows()) {
      const key = readingKey(reading);
      if (key.ok) keys.add(`${simplified}\t${key.value}`);
    }
  });

  it("glosses only existing CC-CEDICT entries", async () => {
    const glosses = await loadFrenchGlosses(dataset);
    expect(glosses.length).toBeGreaterThan(minGlosses);
    const orphans = glosses.filter(([simplified, key]) => !keys.has(`${simplified}\t${key}`));
    expect(orphans.slice(0, 10)).toEqual([]);
  });

  it("adds French-only entries with valid readings that CC-CEDICT does not have", async () => {
    const entries = await loadFrenchEntries(dataset);
    expect(entries.length).toBeGreaterThan(minEntries);
    const invalid = entries.filter(
      (row) =>
        /^$|\s/u.test(row[0]) ||
        /^$|\s/u.test(row[1]) ||
        !/\d/u.test(row[2]) ||
        !toDiacritic(row[2]).ok,
    );
    expect(invalid.slice(0, 10)).toEqual([]);
    const duplicates = entries.filter(([simplified, , reading]) => {
      const key = readingKey(reading);
      return key.ok && keys.has(`${simplified}\t${key.value}`);
    });
    expect(duplicates.slice(0, 10)).toEqual([]);
  });
});

describe("HSK 2025 data", () => {
  it("attaches levels to readings that exist in CC-CEDICT", async () => {
    const readings = new Map<string, Set<string>>();
    for (const [simplified, , reading] of await loadCedictRows()) {
      const key = readingKey(reading);
      if (key.ok) readings.set(simplified, (readings.get(simplified) ?? new Set()).add(key.value));
    }
    const words = await loadHskWords();
    expect(words.length).toBe(10_896);
    const wrong = words.filter(([word, , , keys]) =>
      keys.some((key) => !(readings.get(word)?.has(key) ?? false)),
    );
    expect(wrong.slice(0, 10)).toEqual([]);
    const unattached = words.filter(([, , , keys]) => keys.length === 0).map(([word]) => word);
    expect(unattached.length).toBeLessThan(10);
  });

  it("grades characters that all have a CC-CEDICT entry", async () => {
    const headwords = new Set((await loadCedictRows()).map(([simplified]) => simplified));
    const characters = await loadHskCharacters();
    expect(characters.length).toBe(3_088);
    expect(characters.filter(([character]) => !headwords.has(character))).toEqual([]);
  });
});

describe("GF0025-2021 data", () => {
  it("grades readings that exist in CC-CEDICT", async () => {
    const readings = new Map<string, Set<string>>();
    for (const [simplified, , reading] of await loadCedictRows()) {
      const key = readingKey(reading);
      if (key.ok) readings.set(simplified, (readings.get(simplified) ?? new Set()).add(key.value));
    }
    const words = await loadGf0025Words();
    expect(words.length).toBeGreaterThan(10_900);
    const wrong = words.filter(([word, , , keys]) =>
      keys.some((key) => !(readings.get(word)?.has(key) ?? false)),
    );
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  it("grades 3,000 characters that all have a CC-CEDICT entry", async () => {
    const headwords = new Set((await loadCedictRows()).map(([simplified]) => simplified));
    const characters = await loadGf0025Characters();
    expect(characters.length).toBe(3_000);
    expect(characters.filter(([character]) => !headwords.has(character))).toEqual([]);
  });
});
