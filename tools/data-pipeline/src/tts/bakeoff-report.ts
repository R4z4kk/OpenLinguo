import { err, ok, type Result } from "@openlinguo/core";
import { z } from "zod";
import type { BakeoffCategory, BakeoffItem } from "./bakeoff-set.ts";
import { ENGINE_IDS, type EngineId } from "./engines.ts";

export const PICKS = [...ENGINE_IDS, "none"] as const;
export type Pick = (typeof PICKS)[number];

/** The maintainer listens to the items they choose and picks the best version of each, or none. */
export const picksSchema = z.object({
  picks: z.record(z.string(), z.enum(PICKS)),
  notes: z.record(z.string(), z.string()),
});
export type Picks = z.infer<typeof picksSchema>;

export const checkPicks = (
  items: readonly BakeoffItem[],
  { picks }: Picks,
): Result<number, string> => {
  const ids = new Set(items.map(({ id }) => id));
  const unknown = Object.keys(picks).filter((id) => !ids.has(id));
  if (unknown.length > 0) return err(`unknown item(s): ${unknown.join(", ")}`);
  const count = Object.keys(picks).length;
  return count === 0 ? err("no item has a pick yet") : ok(count);
};

export const formatReport = (
  items: readonly BakeoffItem[],
  engines: readonly EngineId[],
  { picks }: Picks,
): string => {
  const choices: readonly Pick[] = [...engines, "none"];
  const count = (choice: Pick, category: BakeoffCategory | null): number =>
    items.filter(
      ({ id, category: itemCategory }) =>
        picks[id] === choice && (category === null || itemCategory === category),
    ).length;
  const categories = [...new Set(items.map(({ category }) => category))].filter((category) =>
    items.some(({ id, category: itemCategory }) => itemCategory === category && id in picks),
  );
  return [
    `| Best version | ${choices.join(" | ")} |`,
    `|---|${choices.map(() => "---").join("|")}|`,
    `| all (${String(Object.keys(picks).length)} items) | ${choices.map((choice) => String(count(choice, null))).join(" | ")} |`,
    ...categories.map(
      (category) =>
        `| ${category} | ${choices.map((choice) => String(count(choice, category))).join(" | ")} |`,
    ),
    "",
  ].join("\n");
};
