/**
 * Performance budgets (#349). Measured 2026-11-04 on develop (6b09e37): Chromium, Playwright CPU
 * throttling 4x, local network, i7-13700KF, and on a CI runner. Each size limit is the measure plus
 * 14-20 %, each time limit 1.5x or more. Raising one is a decision: say why in the pull request.
 * The sizes are checked after `pnpm build` (`pnpm budgets`), the times in e2e/performance.e2e.ts.
 */
export const BUDGETS_DATED = "2026-11-04";

export type SizeBudget = {
  readonly id: "js" | "css" | "precache" | "import";
  readonly label: string;
  readonly measured: number;
  readonly limit: number;
  readonly fix: string;
};

export const SIZE_BUDGETS: readonly SizeBudget[] = [
  {
    id: "js",
    label: "JavaScript of dist/assets, gzip",
    measured: 493_500,
    limit: 600_000,
    fix: "Every route loads the entry chunk. Find what grew and load it with lazyRouteComponent or import().",
  },
  {
    id: "css",
    label: "CSS of dist/assets, gzip",
    measured: 127_983,
    limit: 150_000,
    fix: "The font-face declarations are most of it: check a new font package or a new font subset.",
  },
  {
    id: "precache",
    label: "Service worker precache, raw",
    measured: 2_157_958,
    limit: 2_500_000,
    fix: "The precache is downloaded on every install: leave the new file out of globPatterns in vite.config.ts, or load it on demand.",
  },
  {
    id: "import",
    label: "First-visit offline data (data/index.json files), raw",
    measured: 29_798_783,
    limit: 34_000_000,
    fix: "The import time grows with these bytes (18 s of CPU at 4x): shrink the packed rows in scripts/pack-data.ts or move a dataset to the on-demand ones.",
  },
];

export type TimingBudgets = {
  /** Playwright CPU throttling, about a mid-range phone (Lighthouse's mobile profile). */
  readonly cpuSlowdown: number;
  /**
   * First visit, import included, until the Today page shows its content: 22-24 s locally, 34 s on CI
   * (run 41863244824, 2026-11-04, with the other tests of the shard running): the budget is 1.5x that.
   */
  readonly coldUsableMs: number;
  /** Median of 3 next visits, data already in IndexedDB: 1.3-1.7 s locally, 1.2-1.3 s on CI. */
  readonly warmUsableMs: number;
};

export const TIMING_BUDGETS: TimingBudgets = {
  cpuSlowdown: 4,
  coldUsableMs: 50_000,
  warmUsableMs: 3_000,
};
