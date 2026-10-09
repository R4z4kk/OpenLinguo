import { readdir, readFile } from "node:fs/promises";

export type CedictRow = readonly [
  simplified: string,
  traditional: string,
  reading: string,
  glosses: readonly string[],
];

export type CfdictRow = readonly [
  simplified: string,
  readingKey: string,
  glosses: readonly string[],
];

const dataDir = new URL("../../../../data/", import.meta.url);

const loadRows = async <Row>(dataset: string): Promise<readonly Row[]> => {
  const dir = new URL(`${dataset}/`, dataDir);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  const shards = await Promise.all(names.map((name) => readFile(new URL(name, dir), "utf8")));
  return shards.flatMap((shard) => JSON.parse(shard) as Row[]);
};

export const loadCedictRows = (): Promise<readonly CedictRow[]> => loadRows("cc-cedict");

export const loadCfdictRows = (): Promise<readonly CfdictRow[]> => loadRows("cfdict");
