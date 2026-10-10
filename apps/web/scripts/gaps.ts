// Builds data/GAPS.md and its lists from the committed datasets.
//   node scripts/gaps.ts                      writes them
//   node scripts/gaps.ts --check              fails when a committed file is out of date
//   node scripts/gaps.ts --review <prev> <out> writes the monthly review issue body
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  GAP_TABLES,
  gapCounts,
  gapReport,
  parseReviewCounts,
  parseTable,
  renderReport,
  reviewBody,
  type GapReport,
  type Table,
} from "../src/build/gaps.ts";
import { CharacterRow } from "../src/data/format.ts";
import { DATA, GradedWord, loadDictionary, readRows } from "./sources.ts";

const REPORT = "GAPS.md";
const CharacterLevel = z.tuple([z.string(), z.number().int()]);

const build = async (): Promise<GapReport> => {
  const tables = new Map<string, Table>();
  for (const path of GAP_TABLES) {
    tables.set(path, parseTable(await readFile(new URL(path, DATA), "utf8")));
  }
  const report = gapReport({
    entries: (await loadDictionary()).entries,
    wordLevels: new Map(
      (await readRows("hsk-2025-words", "words-", GradedWord)).map(([word, level]) => [
        word,
        level,
      ]),
    ),
    characterLevels: new Map(await readRows("hsk-2025-chars", "characters-", CharacterLevel)),
    characters: await readRows("makemeahanzi", "characters-", CharacterRow),
    tables,
  });
  if (!report.ok) throw new Error(report.error);
  return report.value;
};

const outputs = (report: GapReport): Map<string, string> =>
  new Map([[REPORT, renderReport(report.categories)], ...report.files]);

const readOrNull = async (url: URL): Promise<string | null> => {
  try {
    return await readFile(url, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
};

const write = async (): Promise<void> => {
  for (const [path, content] of outputs(await build())) {
    const url = new URL(path, DATA);
    await mkdir(new URL(".", url), { recursive: true });
    await writeFile(url, content, "utf8");
  }
  console.log(`gaps: data/${REPORT} written`);
};

const check = async (): Promise<void> => {
  const stale: string[] = [];
  for (const [path, content] of outputs(await build())) {
    if ((await readOrNull(new URL(path, DATA))) !== content) stale.push(`data/${path}`);
  }
  if (stale.length === 0) {
    console.log(`gaps: data/${REPORT} is up to date`);
    return;
  }
  console.error(`gaps: out of date, run \`pnpm data:gaps\`: ${stale.join(", ")}`);
  process.exitCode = 1;
};

const review = async (previousPath: string, outPath: string): Promise<void> => {
  const server = process.env["GITHUB_SERVER_URL"] ?? "";
  const repository = process.env["GITHUB_REPOSITORY"] ?? "";
  if (server === "" || repository === "") {
    throw new Error("GITHUB_SERVER_URL and GITHUB_REPOSITORY are required for --review");
  }
  const previousBody = (await readFile(previousPath, "utf8")).trim();
  const previous = previousBody === "" ? null : parseReviewCounts(previousBody);
  if (previous !== null && !previous.ok) throw new Error(previous.error);
  const counts = gapCounts((await build()).categories);
  await writeFile(
    outPath,
    reviewBody(
      counts,
      previous === null ? null : previous.value,
      `${server}/${repository}/blob/main/data/${REPORT}`,
    ),
    "utf8",
  );
};

const main = async (): Promise<void> => {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode == null) return write();
  if (mode === "--check" && rest.length === 0) return check();
  const [previous, out] = rest;
  if (mode === "--review" && previous != null && out != null && rest.length === 2) {
    return review(previous, out);
  }
  throw new Error("usage: gaps.ts [--check | --review <previous body> <output>]");
};

main().catch((error: unknown) => {
  console.error(`gaps: ${String(error)}`);
  process.exitCode = 1;
});
