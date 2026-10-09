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
  dataset: string,
): Promise<Result<CedictIndex, string>> => {
  const shards = await readShards("cc-cedict");
  if (!shards.ok) return err(`cannot read cc-cedict: ${shards.error}`);
  if (shards.value.length === 0) return err(`cc-cedict must be built before ${dataset}`);
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

export type FrenchEntry = {
  readonly id: string;
  readonly simplified: string;
  readonly traditional: string;
  readonly reading: string;
  readonly glosses: readonly string[];
};

export type FrenchJoin = {
  /** `[simplified, lowercase numbered pinyin, French glosses]` attached to CC-CEDICT entries. */
  readonly glossRows: readonly (readonly [string, string, readonly string[]])[];
  /** `[simplified, traditional, numbered pinyin, French glosses]` for words CC-CEDICT lacks. */
  readonly entryRows: readonly (readonly [string, string, string, readonly string[]])[];
  readonly conflicts: readonly string[];
  readonly rejected: readonly FrenchEntry[];
  readonly summary: string;
};

type Glossed<Row> = { readonly row: Row; readonly glosses: Set<string> };

const addGlosses = <Row extends readonly string[]>(
  map: Map<string, Glossed<Row>>,
  row: Row,
  glosses: readonly string[],
): void => {
  const key = JSON.stringify(row);
  const merged = map.get(key) ?? { row, glosses: new Set<string>() };
  for (const gloss of glosses) merged.glosses.add(gloss);
  map.set(key, merged);
};

export const joinFrenchEntries = (
  index: CedictIndex,
  entries: readonly FrenchEntry[],
): FrenchJoin => {
  const joined = new Map<string, Glossed<readonly [string, string]>>();
  const frenchOnly = new Map<string, Glossed<readonly [string, string, string]>>();
  const counts = { exact: 0, "traditional-form": 0, "neutral-tone": 0, "tone-conflict": 0 };
  const conflicts: string[] = [];
  const rejected: FrenchEntry[] = [];
  let ambiguous = 0;
  for (const entry of entries) {
    const outcome = matchEntry(index, entry.simplified, entry.reading);
    if (outcome.kind === "rejected") {
      rejected.push(entry);
    } else if (outcome.kind === "joined") {
      counts[outcome.via] += 1;
      addGlosses(joined, [outcome.target.simplified, outcome.target.key], entry.glosses);
      if (outcome.via === "tone-conflict") {
        conflicts.push(
          `${entry.id}\t${entry.simplified}\t${entry.reading}\t${outcome.target.reading}`,
        );
      }
    } else {
      if (outcome.ambiguous) ambiguous += 1;
      addGlosses(frenchOnly, [entry.simplified, entry.traditional, outcome.reading], entry.glosses);
    }
  }
  const glossRows = [...joined.values()].map(({ row, glosses }) => [...row, [...glosses]] as const);
  const entryRows = [...frenchOnly.values()].map(
    ({ row, glosses }) => [...row, [...glosses]] as const,
  );
  const summary = [
    `${String(joined.size)} CC-CEDICT keys glossed (${String(counts.exact)} exact, ${String(counts["traditional-form"])} via traditional form, ${String(counts["neutral-tone"])} neutral-tone, ${String(counts["tone-conflict"])} tone conflicts)`,
    `${String(frenchOnly.size)} French-only entries (${String(ambiguous)} ambiguous)`,
    `${String(rejected.length)} rejected`,
  ].join(", ");
  return { glossRows, entryRows, conflicts, rejected, summary };
};
