import { readdir, readFile } from "node:fs/promises";
import type { GradedWord } from "../datasets/graded.ts";
import { dataDir } from "../manifest.ts";

export const REFERENTIALS = {
  "hsk-2025": "hsk-2025-words",
  "gf0025-2021": "gf0025-2021-words",
} as const;
export type Referential = keyof typeof REFERENTIALS;
export type WordLists = Readonly<Record<Referential, readonly GradedWord[]>>;

export type Band = { readonly referential: Referential; readonly level: number };
export type PackItem = { readonly word: string; readonly reading: string };
export type Gap = PackItem & { readonly reason: "several-readings" | "no-reading" | "rejected" };

export const isReferential = (value: string): value is Referential => value in REFERENTIALS;

export const itemKey = ({ word, reading }: PackItem): string => `${word}\t${reading}`;

/** Spoken syllables: the erhua "r5" is said inside the syllable before it. */
export const syllableCount = ({ reading }: PackItem): number =>
  reading.split(" ").filter((syllable) => syllable !== "r5").length;

export const loadWordLists = async (): Promise<WordLists> => {
  const load = async (dataset: string): Promise<GradedWord[]> => {
    const dir = new URL(`${dataset}/`, dataDir);
    const names = (await readdir(dir)).filter((name) => /^words-\d+\.json$/u.test(name)).sort();
    const shards = await Promise.all(names.map((name) => readFile(new URL(name, dir), "utf8")));
    return shards.flatMap((shard) => JSON.parse(shard) as GradedWord[]);
  };
  return {
    "hsk-2025": await load(REFERENTIALS["hsk-2025"]),
    "gf0025-2021": await load(REFERENTIALS["gf0025-2021"]),
  };
};

/**
 * Words with several readings in either referential. MOSS-TTS reads characters only and cannot be told which
 * reading to say, so they get no audio until the tone classifier (#115) can check it (#113).
 */
export const severalReadings = (lists: WordLists): ReadonlySet<string> => {
  const readings = new Map<string, Set<string>>();
  for (const rows of Object.values(lists)) {
    for (const [word, , , keys] of rows) {
      const known = readings.get(word) ?? new Set<string>();
      for (const key of keys) known.add(key);
      readings.set(word, known);
    }
  }
  return new Set([...readings].filter(([, keys]) => keys.size > 1).map(([word]) => word));
};

/** The readings of the words whose lowest level is the band, and the ones left without audio. */
export const bandItems = (
  lists: WordLists,
  { referential, level }: Band,
  excluded: ReadonlySet<string>,
): { readonly items: readonly PackItem[]; readonly gaps: readonly Gap[] } => {
  const items: PackItem[] = [];
  const gaps: Gap[] = [];
  for (const [word, lowest, , readings] of lists[referential]) {
    if (lowest !== level) continue;
    if (readings.length === 0) gaps.push({ word, reading: "", reason: "no-reading" });
    for (const reading of readings) {
      if (excluded.has(word)) gaps.push({ word, reading, reason: "several-readings" });
      else items.push({ word, reading });
    }
  }
  return { items, gaps };
};
