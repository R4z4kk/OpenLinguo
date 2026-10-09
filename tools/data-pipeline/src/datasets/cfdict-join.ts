import { err, ok, parseWith, type Result } from "@openlinguo/core";
import { formatNumbered, parseNumbered, type ReadingToken } from "@openlinguo/lang-zh";
import { z } from "zod";
import type { ShardReader } from "../run.ts";

type CedictEntry = {
  readonly simplified: string;
  readonly reading: string;
  readonly key: string;
  readonly tokens: readonly ReadingToken[];
};

export type CedictIndex = {
  readonly bySimplified: ReadonlyMap<string, readonly CedictEntry[]>;
  readonly byTraditional: ReadonlyMap<string, readonly CedictEntry[]>;
};

export type JoinOutcome =
  | {
      readonly kind: "joined";
      readonly target: CedictEntry;
      readonly via: "exact" | "traditional-form" | "neutral-tone" | "tone-conflict";
    }
  | { readonly kind: "french-only"; readonly reading: string; readonly ambiguous: boolean }
  | { readonly kind: "rejected" };

const CedictShard = z.array(z.tuple([z.string(), z.string(), z.string(), z.array(z.string())]));

const keyOf = (tokens: readonly ReadingToken[]): string => formatNumbered(tokens).toLowerCase();

const push = (map: Map<string, CedictEntry[]>, key: string, entry: CedictEntry): void => {
  const bucket = map.get(key);
  if (bucket) bucket.push(entry);
  else map.set(key, [entry]);
};

export const loadCedictIndex = async (
  readShards: ShardReader,
): Promise<Result<CedictIndex, string>> => {
  const shards = await readShards("cc-cedict");
  if (!shards.ok) return err(`cannot read cc-cedict: ${shards.error}`);
  if (shards.value.length === 0) return err("cc-cedict must be built before cfdict");
  const bySimplified = new Map<string, CedictEntry[]>();
  const byTraditional = new Map<string, CedictEntry[]>();
  for (const shard of shards.value) {
    let json: unknown;
    try {
      json = JSON.parse(shard);
    } catch (error) {
      return err(`invalid cc-cedict shard: ${String(error)}`);
    }
    const rows = parseWith(CedictShard, json);
    if (!rows.ok) return err("invalid cc-cedict shard structure");
    for (const [simplified, traditional, reading] of rows.value) {
      const tokens = parseNumbered(reading);
      if (!tokens.ok) continue;
      const entry = { simplified, reading, key: keyOf(tokens.value), tokens: tokens.value };
      push(bySimplified, simplified, entry);
      if (traditional !== simplified) push(byTraditional, traditional, entry);
    }
  }
  return ok({ bySimplified, byTraditional });
};

const sameShape = (a: readonly ReadingToken[], b: readonly ReadingToken[]): boolean =>
  a.length === b.length &&
  a.every((token, index) => {
    const other = b[index];
    if (token.kind === "syllable") {
      return (
        other?.kind === "syllable" && other.letters.toLowerCase() === token.letters.toLowerCase()
      );
    }
    return other?.kind === "other" && other.text.toLowerCase() === token.text.toLowerCase();
  });

const hasToneConflict = (a: readonly ReadingToken[], b: readonly ReadingToken[]): boolean =>
  a.some((token, index) => {
    const other = b[index];
    return (
      token.kind === "syllable" &&
      other?.kind === "syllable" &&
      token.tone !== other.tone &&
      token.tone !== 5 &&
      other.tone !== 5
    );
  });

/** CFDICT writes the erhua suffix as a toneless `r`, CC-CEDICT as `r5`. */
const normalizeErhua = (reading: string): string =>
  reading
    .split(" ")
    .map((token) => (token === "r" ? "r5" : token))
    .join(" ");

export const matchEntry = (
  index: CedictIndex,
  simplified: string,
  reading: string,
): JoinOutcome => {
  const tokens = parseNumbered(normalizeErhua(reading));
  if (!tokens.ok) return { kind: "rejected" };
  const key = keyOf(tokens.value);
  const direct = index.bySimplified.get(simplified) ?? [];
  const traditional = index.byTraditional.get(simplified) ?? [];

  const exact = direct.find((candidate) => candidate.key === key);
  if (exact) return { kind: "joined", target: exact, via: "exact" };
  const viaTraditional = traditional.find((candidate) => candidate.key === key);
  if (viaTraditional) return { kind: "joined", target: viaTraditional, via: "traditional-form" };

  const related = new Map(
    [...direct, ...traditional]
      .filter((candidate) => sameShape(candidate.tokens, tokens.value))
      .map((candidate) => [`${candidate.simplified}\t${candidate.key}`, candidate]),
  );
  const [only] = related.values();
  if (related.size === 1 && only) {
    const via = hasToneConflict(only.tokens, tokens.value) ? "tone-conflict" : "neutral-tone";
    return { kind: "joined", target: only, via };
  }
  return {
    kind: "french-only",
    reading: formatNumbered(tokens.value),
    ambiguous: related.size > 1,
  };
};
