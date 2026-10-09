import { readdir, readFile } from "node:fs/promises";

export type CedictRow = readonly [
  simplified: string,
  traditional: string,
  reading: string,
  glosses: readonly string[],
];

const shardDir = new URL("../../../../data/cc-cedict/", import.meta.url);

export const loadCedictRows = async (): Promise<readonly CedictRow[]> => {
  const names = (await readdir(shardDir)).filter((name) => name.endsWith(".json"));
  const shards = await Promise.all(names.map((name) => readFile(new URL(name, shardDir), "utf8")));
  return shards.flatMap((shard) => JSON.parse(shard) as CedictRow[]);
};
