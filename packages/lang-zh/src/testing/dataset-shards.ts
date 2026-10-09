import { readdir, readFile } from "node:fs/promises";

export type CedictRow = readonly [
  simplified: string,
  traditional: string,
  reading: string,
  glosses: readonly string[],
];

export type CfdictGlossRow = readonly [
  simplified: string,
  readingKey: string,
  glosses: readonly string[],
];

export type HskWordRow = readonly [
  word: string,
  level: number,
  otherLevels: readonly number[],
  readingKeys: readonly string[],
];

const dataDir = new URL("../../../../data/", import.meta.url);

const loadRows = async <Row>(dataset: string, prefix: string): Promise<readonly Row[]> => {
  const dir = new URL(`${dataset}/`, dataDir);
  const names = (await readdir(dir)).filter(
    (name) => name.startsWith(prefix) && name.endsWith(".json"),
  );
  const shards = await Promise.all(names.map((name) => readFile(new URL(name, dir), "utf8")));
  return shards.flatMap((shard) => JSON.parse(shard) as Row[]);
};

export const loadCedictRows = (): Promise<readonly CedictRow[]> =>
  loadRows("cc-cedict", "entries-");

export const loadCfdictGlosses = (): Promise<readonly CfdictGlossRow[]> =>
  loadRows("cfdict", "glosses-");

export const loadCfdictEntries = (): Promise<readonly CedictRow[]> =>
  loadRows("cfdict", "entries-");

export const loadHskWords = (): Promise<readonly HskWordRow[]> =>
  loadRows("hsk-2025-words", "words-");

export const loadHskCharacters = (): Promise<readonly (readonly [string, number])[]> =>
  loadRows("hsk-2025-chars", "characters-");

export const loadGf0025Words = (): Promise<readonly HskWordRow[]> =>
  loadRows("gf0025-2021-words", "words-");

export const loadGf0025Characters = (): Promise<readonly (readonly [string, number])[]> =>
  loadRows("gf0025-2021-chars", "characters-");
