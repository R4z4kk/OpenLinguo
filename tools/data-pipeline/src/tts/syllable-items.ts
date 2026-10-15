import { readdir, readFile } from "node:fs/promises";
import { err, ok, type InvalidReading, type Result } from "@openlinguo/core";
import { FINALS, INITIALS, readingKey, spell } from "@openlinguo/lang-zh";
import { dataDir } from "../manifest.ts";
import type { Gap, PackItem } from "./pack-words.ts";

type CedictRow = readonly [simplified: string, traditional: string, reading: string];

const TONES = [1, 2, 3, 4] as const;

/** The syllables of the pinyin chart (lang-zh pinyin-chart.ts) in the four tones, as reading keys: `lu:4`. */
export const chartPairs = (): Result<readonly string[], InvalidReading> => {
  const pairs = new Set<string>();
  for (const pinyinFinal of FINALS) {
    for (const initial of [null, ...INITIALS]) {
      const written = spell(initial?.letters ?? null, pinyinFinal);
      if (written === null) continue;
      for (const tone of TONES) {
        const key = readingKey(`${written}${String(tone)}`);
        if (!key.ok) return key;
        pairs.add(key.value);
      }
    }
  }
  return ok([...pairs]);
};

/**
 * Every reading a simplified character takes in CC-CEDICT, words included (钥 is yue4 alone, yao4 in 钥匙),
 * as reading keys. A neutral tone inside a word is left out: it is said so in context only.
 */
export const charReadings = (
  rows: readonly CedictRow[],
): ReadonlyMap<string, ReadonlySet<string>> => {
  const map = new Map<string, Set<string>>();
  for (const [simplified, , reading] of rows) {
    const syllables = reading.split(" ");
    const chars = Array.from(simplified);
    if (chars.length !== syllables.length) continue;
    chars.forEach((char, index) => {
      const key = readingKey(syllables[index] ?? "");
      if (!key.ok || (chars.length > 1 && key.value.endsWith("5"))) return;
      const known = map.get(char) ?? new Set<string>();
      known.add(key.value);
      map.set(char, known);
    });
  }
  return map;
};

const byFrequency =
  (frequency: ReadonlyMap<string, number>) =>
  (a: string, b: string): number =>
    (frequency.get(b) ?? 0) - (frequency.get(a) ?? 0) ||
    (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0);

/**
 * One recording per syllable and tone of the chart that CC-CEDICT attests. A pair takes a word pack's
 * one-character recording when one ships (the same file), else the most frequent character CC-CEDICT reads
 * only that way: MOSS-TTS reads characters, not pinyin (ADR 0007). A pair with neither has no audio.
 */
export const syllableItems = ({
  pairs,
  readings,
  frequency,
  shipped,
}: {
  readonly pairs: readonly string[];
  readonly readings: ReadonlyMap<string, ReadonlySet<string>>;
  readonly frequency: ReadonlyMap<string, number>;
  /** Word pack recordings that pass their checks. */
  readonly shipped: readonly PackItem[];
}): { readonly items: readonly PackItem[]; readonly gaps: readonly Gap[] } => {
  const order = byFrequency(frequency);
  const reused = new Map<string, string[]>();
  for (const { word, reading } of shipped) {
    if (Array.from(word).length === 1) reused.set(reading, [...(reused.get(reading) ?? []), word]);
  }
  const attested = new Set<string>();
  const only = new Map<string, string[]>();
  for (const [char, keys] of readings) {
    for (const key of keys) attested.add(key);
    const [key = ""] = keys;
    if (keys.size === 1) only.set(key, [...(only.get(key) ?? []), char]);
  }
  const items: PackItem[] = [];
  const gaps: Gap[] = [];
  for (const reading of pairs) {
    if (!attested.has(reading)) continue;
    const [word = null] = [...(reused.get(reading) ?? only.get(reading) ?? [])].sort(order);
    if (word === null) gaps.push({ word: "", reading, reason: "no-character" });
    else items.push({ word, reading });
  }
  return { items, gaps };
};

const readShards = async <T>(dataset: string, prefix: string): Promise<T[]> => {
  const dir = new URL(`${dataset}/`, dataDir);
  const names = (await readdir(dir)).filter((name) => name.startsWith(prefix)).sort();
  const shards = await Promise.all(names.map((name) => readFile(new URL(name, dir), "utf8")));
  return shards.flatMap((shard) => JSON.parse(shard) as T[]);
};

export const loadSyllableSources = async (): Promise<
  Result<
    {
      readonly pairs: readonly string[];
      readonly readings: ReadonlyMap<string, ReadonlySet<string>>;
      readonly frequency: ReadonlyMap<string, number>;
    },
    InvalidReading
  >
> => {
  const pairs = chartPairs();
  if (!pairs.ok) return err(pairs.error);
  const rows = await readShards<CedictRow>("cc-cedict", "entries-");
  const words = await readShards<readonly [string, number]>("wordfreq-zh", "words-");
  return ok({ pairs: pairs.value, readings: charReadings(rows), frequency: new Map(words) });
};
