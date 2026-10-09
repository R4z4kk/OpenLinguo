import type { Manifest } from "./manifest.ts";

const DAY_MS = 86_400_000;

export type FreshnessProblem =
  | {
      readonly kind: "expired";
      readonly dataset: string;
      readonly ageDays: number;
      readonly maxAgeDays: number;
    }
  | { readonly kind: "future-date"; readonly dataset: string; readonly retrievedAt: string };

export const freshnessProblems = (manifest: Manifest, now: Date): readonly FreshnessProblem[] =>
  Object.entries(manifest).flatMap(([dataset, entry]): FreshnessProblem[] => {
    const ageMs = now.getTime() - Date.parse(entry.retrievedAt);
    if (ageMs < 0) return [{ kind: "future-date", dataset, retrievedAt: entry.retrievedAt }];
    const ageDays = Math.floor(ageMs / DAY_MS);
    return ageDays > entry.maxAgeDays
      ? [{ kind: "expired", dataset, ageDays, maxAgeDays: entry.maxAgeDays }]
      : [];
  });

export const formatProblem = (problem: FreshnessProblem): string =>
  problem.kind === "expired"
    ? `${problem.dataset}: retrieved ${String(problem.ageDays)} days ago, max ${String(problem.maxAgeDays)}. Run the data-refresh workflow or \`pipeline ${problem.dataset} --refresh\`.`
    : `${problem.dataset}: retrievedAt ${problem.retrievedAt} is in the future.`;
