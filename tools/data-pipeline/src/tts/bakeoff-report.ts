import { err, ok, type Result } from "@openlinguo/core";
import { z } from "zod";
import type { BakeoffCategory, BakeoffItem } from "./bakeoff-set.ts";
import type { EngineId } from "./engines.ts";

export const LABELS = ["A", "B", "C"] as const;
export type Label = (typeof LABELS)[number];
export type BakeoffKey = Readonly<Record<string, Readonly<Partial<Record<Label, EngineId>>>>>;

export const gradesSchema = z.object({
  grades: z.array(
    z.object({
      item: z.string(),
      label: z.enum(LABELS),
      tonesRight: z.boolean(),
      naturalness: z.int().min(1).max(5),
    }),
  ),
  notes: z.record(z.string(), z.string()),
});
export type Grades = z.infer<typeof gradesSchema>;

export type RevealedGrade = {
  readonly item: string;
  readonly category: BakeoffCategory;
  readonly engine: EngineId;
  readonly tonesRight: boolean;
  readonly naturalness: number;
};

const seedOf = (text: string): number => {
  let hash = 0x811c9dc5;
  for (const char of text) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193);
  return hash >>> 0;
};

const random = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
};

/** Engines in a shuffled order per item, so a label never names the same engine twice in a row. */
export const makeKey = (items: readonly BakeoffItem[], engines: readonly EngineId[]): BakeoffKey =>
  Object.fromEntries(
    items.map(({ id }) => {
      const next = random(seedOf(id));
      const order = [...engines];
      for (let index = order.length - 1; index > 0; index--) {
        const other = Math.floor(next() * (index + 1));
        [order[index], order[other]] = [order[other] as EngineId, order[index] as EngineId];
      }
      return [id, Object.fromEntries(order.map((engine, index) => [LABELS[index], engine]))];
    }),
  );

export const reveal = (
  items: readonly BakeoffItem[],
  key: BakeoffKey,
  { grades }: Grades,
): Result<readonly RevealedGrade[], string> => {
  const byItem = new Map(items.map((item) => [item.id, item]));
  const revealed: RevealedGrade[] = [];
  const seen = new Set<string>();
  for (const grade of grades) {
    const item = byItem.get(grade.item) ?? null;
    const engine = key[grade.item]?.[grade.label] ?? null;
    if (item === null || engine === null) return err(`unknown sample ${grade.item} ${grade.label}`);
    if (seen.has(`${grade.item}\t${grade.label}`))
      return err(`sample graded twice: ${grade.item} ${grade.label}`);
    seen.add(`${grade.item}\t${grade.label}`);
    revealed.push({ ...grade, category: item.category, engine });
  }
  const expected = items.reduce((count, { id }) => count + Object.keys(key[id] ?? {}).length, 0);
  if (revealed.length !== expected) {
    return err(
      `${String(expected - revealed.length)} of ${String(expected)} samples are not graded yet`,
    );
  }
  return ok(revealed);
};

const percent = (grades: readonly RevealedGrade[]): string => {
  const right = grades.filter(({ tonesRight }) => tonesRight).length;
  return `${String(Math.round((100 * right) / grades.length))} % (${String(right)}/${String(grades.length)})`;
};

const meanNaturalness = (grades: readonly RevealedGrade[]): string =>
  (grades.reduce((sum, { naturalness }) => sum + naturalness, 0) / grades.length).toFixed(2);

export const formatReport = (
  items: readonly BakeoffItem[],
  engines: readonly EngineId[],
  grades: readonly RevealedGrade[],
): string => {
  const of = (engine: EngineId, category: BakeoffCategory | null): RevealedGrade[] =>
    grades.filter(
      (grade) => grade.engine === engine && (category === null || grade.category === category),
    );
  const categories = [...new Set(items.map(({ category }) => category))];
  return [
    "| Engine | Tones right | Naturalness (1–5) |",
    "|---|---|---|",
    ...engines.map(
      (engine) =>
        `| ${engine} | ${percent(of(engine, null))} | ${meanNaturalness(of(engine, null))} |`,
    ),
    "",
    `| Tones right | ${engines.join(" | ")} |`,
    `|---|${engines.map(() => "---").join("|")}|`,
    ...categories.map(
      (category) =>
        `| ${category} | ${engines.map((engine) => percent(of(engine, category))).join(" | ")} |`,
    ),
    "",
  ].join("\n");
};
