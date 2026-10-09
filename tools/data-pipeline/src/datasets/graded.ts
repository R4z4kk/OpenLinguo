import { err, ok, parseWith, type Result } from "@openlinguo/core";
import { readingKey } from "@openlinguo/lang-zh";
import { z } from "zod";
import type { ShardReader } from "../run.ts";

export type Candidate = { readonly key: string; readonly reading: string };

/** `[word, lowest level, other levels, CC-CEDICT reading keys]` */
export type GradedWord = readonly [string, number, readonly number[], readonly string[]];

export const decodeUtf8 = (raw: Uint8Array): Result<string, string> => {
  try {
    return ok(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch (error) {
    return err(`cannot decode: ${String(error)}`);
  }
};

const CedictShard = z.array(z.tuple([z.string(), z.string(), z.string(), z.array(z.string())]));

/** Distinct CC-CEDICT readings per simplified headword. */
export const loadReadings = async (
  readShards: ShardReader,
  dataset: string,
): Promise<Result<ReadonlyMap<string, readonly Candidate[]>, string>> => {
  const shards = await readShards("cc-cedict");
  if (!shards.ok) return err(`cannot read cc-cedict: ${shards.error}`);
  if (shards.value.length === 0) return err(`cc-cedict must be built before ${dataset}`);
  const readings = new Map<string, Candidate[]>();
  for (const shard of shards.value) {
    let json: unknown;
    try {
      json = JSON.parse(shard);
    } catch (error) {
      return err(`invalid cc-cedict shard: ${String(error)}`);
    }
    const rows = parseWith(CedictShard, json);
    if (!rows.ok) return err("invalid cc-cedict shard structure");
    for (const [simplified, , reading] of rows.value) {
      const key = readingKey(reading);
      if (!key.ok) continue;
      const candidates = readings.get(simplified) ?? [];
      if (!candidates.some((candidate) => candidate.key === key.value)) {
        candidates.push({ key: key.value, reading });
      }
      readings.set(simplified, candidates);
    }
  }
  return ok(readings);
};
