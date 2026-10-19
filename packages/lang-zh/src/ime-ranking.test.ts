import { ok, type ImeFeature } from "@openlinguo/core";
import { beforeAll, describe, expect, it } from "vitest";
import { createIme, type ImeWord } from "./ime.ts";
import { readingKey } from "./pinyin.ts";
import { searchKey } from "./pinyin-search.ts";
import {
  loadCedictRows,
  loadHskWords,
  loadWordFrequencies,
  type HskWordRow,
} from "./testing/dataset-shards.ts";

const FIRST_PAGE = 9;

/** CC-CEDICT words by toneless reading, one per headword and reading, as the web data layer stores them. */
const cedictWords = async (): Promise<ReadonlyMap<string, readonly ImeWord[]>> => {
  const frequencies = new Map(await loadWordFrequencies());
  const entries = new Map<string, ImeWord>();
  for (const [simplified, , reading] of await loadCedictRows()) {
    const key = readingKey(reading);
    if (!key.ok) continue;
    const id = `${simplified}\t${key.value}`;
    const kept = entries.get(id) ?? null;
    // A lowercase reading (common word) is kept before a capitalized one (proper noun).
    if (kept !== null && (/^[a-z]/u.test(kept.reading) || !/^[a-z]/u.test(reading))) continue;
    entries.set(id, {
      headword: simplified,
      reading,
      frequency: frequencies.get(simplified) ?? null,
    });
  }
  const byKey = new Map<string, ImeWord[]>();
  for (const word of entries.values()) {
    const key = searchKey(word.reading);
    const words = byKey.get(key) ?? [];
    words.push(word);
    byKey.set(key, words);
  }
  return byKey;
};

/** `dian4 hua4` typed as `dianhua`. */
const toneless = (key: string): string => searchKey(key);

/** `nu:3 hai2 r5` typed as `nv3hai2r5`. */
const withTones = (key: string): string => key.replace(/u:/gu, "v").replace(/ /gu, "");

/** Share of the HSK 2025 readings whose word is on the first page of candidates. */
const firstPageShare = async (
  ime: ImeFeature,
  words: readonly HskWordRow[],
  typed: (key: string) => string,
): Promise<number> => {
  let found = 0;
  let total = 0;
  for (const [word, , , keys] of words) {
    for (const key of keys) {
      total++;
      const candidates = await ime.candidates(typed(key));
      const page = candidates.ok ? candidates.value.slice(0, FIRST_PAGE) : [];
      if (page.some((candidate) => candidate.text === word)) found++;
    }
  }
  return found / total;
};

describe("ime ranking over CC-CEDICT and wordfreq", () => {
  let ime: ImeFeature = createIme(() => Promise.resolve(ok([])));
  let hskWords: readonly HskWordRow[] = [];

  beforeAll(async () => {
    const words = await cedictWords();
    ime = createIme((key) => Promise.resolve(ok(words.get(key) ?? [])));
    hskWords = await loadHskWords();
  }, 60_000);

  it("puts 97 % of HSK 2025 readings typed without tones on the first page", async () => {
    expect(await firstPageShare(ime, hskWords, toneless)).toBeGreaterThanOrEqual(0.97);
  }, 60_000);

  it("puts 99 % of HSK 2025 readings typed with tone numbers on the first page", async () => {
    expect(await firstPageShare(ime, hskWords, withTones)).toBeGreaterThanOrEqual(0.99);
  }, 60_000);
});
