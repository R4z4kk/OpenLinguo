import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { err, ok, type Result } from "@openlinguo/core";
import { z } from "zod";
import { DataIndex } from "../data/format.ts";
import type { SizeBudget } from "./budgets.ts";

export type Measures = Readonly<Record<SizeBudget["id"], number>>;

export type Overrun = { readonly budget: SizeBudget; readonly measure: number };

const withExtension = async (dir: string, extension: string): Promise<readonly string[]> =>
  (await readdir(dir)).filter((name) => name.endsWith(extension)).map((name) => join(dir, name));

const gzipBytes = async (paths: readonly string[]): Promise<number> => {
  let total = 0;
  for (const path of paths) total += gzipSync(await readFile(path)).length;
  return total;
};

/** The `url` of each entry vite-plugin-pwa writes into `sw.js`, once each. */
export const precachedUrls = (serviceWorker: string): readonly string[] => [
  ...new Set([...serviceWorker.matchAll(/url:"([^"]+)"/gu)].map((match) => match[1] ?? "")),
];

const sizeOf = async (paths: readonly string[]): Promise<number> => {
  let total = 0;
  for (const path of paths) total += (await stat(path)).size;
  return total;
};

/** Sizes of the production build in `dist`, as the budgets count them. */
export const measureBuild = async (dist: string): Promise<Result<Measures, string>> => {
  try {
    const assets = join(dist, "assets");
    const urls = precachedUrls(await readFile(join(dist, "sw.js"), "utf8"));
    if (urls.length === 0) return err("sw.js lists no precached file: its format changed");
    const json: unknown = JSON.parse(await readFile(join(dist, "data", "index.json"), "utf8"));
    const index = DataIndex.safeParse(json);
    if (!index.success) return err(`data/index.json: ${z.prettifyError(index.error)}`);
    return ok({
      js: await gzipBytes(await withExtension(assets, ".js")),
      css: await gzipBytes(await withExtension(assets, ".css")),
      precache: await sizeOf(urls.map((url) => join(dist, url))),
      import: await sizeOf(index.data.files.map((file) => join(dist, "data", file.name))),
    });
  } catch (error) {
    return err(`cannot measure ${dist}, did \`pnpm build\` run? ${String(error)}`);
  }
};

export const overruns = (measures: Measures, budgets: readonly SizeBudget[]): readonly Overrun[] =>
  budgets.flatMap((budget) => {
    const measure = measures[budget.id];
    return measure > budget.limit ? [{ budget, measure }] : [];
  });

const kilobytes = (bytes: number): string => `${(bytes / 1000).toFixed(0)} kB`;

export const describeOverrun = ({ budget, measure }: Overrun): string =>
  `${budget.label}: ${kilobytes(measure)}, over the ${kilobytes(budget.limit)} budget. ${budget.fix} ` +
  "If the growth is intended, raise the limit in src/build/budgets.ts and say why in the pull request.";
