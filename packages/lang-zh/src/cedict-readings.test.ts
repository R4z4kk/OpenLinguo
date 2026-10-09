import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { toDiacritic, toNumbered } from "./pinyin.ts";

const shardDir = new URL("../../../data/cc-cedict/", import.meta.url);
const NO_READING = "xx5";

const roundTrips = (reading: string): boolean => {
  const diacritic = toDiacritic(reading);
  if (!diacritic.ok) return false;
  const numbered = toNumbered(diacritic.value);
  return numbered.ok && numbered.value === reading;
};

const readings = async (): Promise<string[]> => {
  const names = (await readdir(shardDir)).filter((name) => name.endsWith(".json"));
  const shards = await Promise.all(names.map((name) => readFile(new URL(name, shardDir), "utf8")));
  return shards.flatMap((shard) =>
    (JSON.parse(shard) as [string, string, string, string[]][]).map(([, , reading]) => reading),
  );
};

describe("CC-CEDICT readings", () => {
  it("all convert to diacritics, except the no-reading placeholder", async () => {
    const all = await readings();
    expect(all.length).toBeGreaterThan(100_000);
    const failures = all.filter((reading) => !toDiacritic(reading).ok);
    const placeholders = all.filter((reading) => reading.split(" ").includes(NO_READING));
    expect(placeholders.length).toBeGreaterThan(0);
    expect(failures).toEqual(placeholders);
  });

  it("round-trip through diacritics when every token is a syllable", async () => {
    const syllablesOnly = (await readings()).filter((reading) =>
      reading.split(" ").every((token) => /\d$/u.test(token) && token !== NO_READING),
    );
    expect(syllablesOnly.length).toBeGreaterThan(100_000);
    expect(syllablesOnly.filter((reading) => !roundTrips(reading)).slice(0, 10)).toEqual([]);
  });
});
