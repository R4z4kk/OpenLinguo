import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { err, ok } from "@openlinguo/core";
import { ccCedict } from "./datasets/cc-cedict.ts";
import { cfdict } from "./datasets/cfdict.ts";
import { lxgwWenKaiGb, notoSansSc400, notoSansSc700 } from "./datasets/fonts.ts";
import { gf0025Chars, gf0025Words } from "./datasets/gf0025-2021.ts";
import { hanziWriterData } from "./datasets/hanzi-writer-data.ts";
import { hsk2025Chars, hsk2025Words } from "./datasets/hsk-2025.ts";
import { makemeahanzi } from "./datasets/makemeahanzi.ts";
import { wiktionaryFrZh } from "./datasets/wiktionary-fr-zh.ts";
import { wordfreqZh } from "./datasets/wordfreq-zh.ts";
import { diffRows } from "./diff.ts";
import {
  dataDir,
  formatManifestError,
  manifestPath,
  readManifest,
  serializeManifest,
} from "./manifest.ts";
import { fetchBytes, formatError, runDataset, type Dataset, type ShardReader } from "./run.ts";

const datasets: ReadonlyMap<string, Dataset> = new Map([
  [ccCedict.id, ccCedict],
  [cfdict.id, cfdict],
  [wiktionaryFrZh.id, wiktionaryFrZh],
  [wordfreqZh.id, wordfreqZh],
  [hsk2025Chars.id, hsk2025Chars],
  [hsk2025Words.id, hsk2025Words],
  [gf0025Chars.id, gf0025Chars],
  [gf0025Words.id, gf0025Words],
  [makemeahanzi.id, makemeahanzi],
  [hanziWriterData.id, hanziWriterData],
  [notoSansSc400.id, notoSansSc400],
  [notoSansSc700.id, notoSansSc700],
  [lxgwWenKaiGb.id, lxgwWenKaiGb],
]);

const fail = (message: string): void => {
  console.error(message);
  process.exitCode = 1;
};

const isShard = (name: string): boolean => name.endsWith(".json");

const readShards = async (dir: URL): Promise<string[]> => {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  return Promise.all(names.filter(isShard).map((name) => readFile(new URL(name, dir), "utf8")));
};

const readBuiltShards: ShardReader = async (dataset) => {
  try {
    return ok(await readShards(new URL(`${dataset}/`, dataDir)));
  } catch (error) {
    return err(String(error));
  }
};

const main = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    options: { refresh: { type: "boolean", default: false } },
    allowPositionals: true,
  });
  const ids = positionals.length > 0 ? positionals : [...datasets.keys()];
  const unknown = ids.filter((id) => !datasets.has(id));
  if (unknown.length > 0) {
    fail(`Unknown dataset(s): ${unknown.join(", ")}. Known: ${[...datasets.keys()].join(", ")}`);
    return;
  }

  const manifest = await readManifest(manifestPath);
  if (!manifest.ok) {
    fail(formatManifestError(manifest.error));
    return;
  }

  const next = { ...manifest.value };
  for (const id of ids) {
    const dataset = datasets.get(id);
    if (dataset == null) continue;
    const result = await runDataset(dataset, manifest.value, {
      refresh: values.refresh,
      now: new Date(),
      fetchBytes,
      readShards: readBuiltShards,
    });
    if (!result.ok) {
      fail(formatError(result.error));
      return;
    }
    const outDir = new URL(`${id}/`, dataDir);
    const previous = await readShards(outDir);
    const { files, entry, summary } = result.value;
    const diff = diffRows(
      previous,
      [...files].flatMap(([name, content]) =>
        isShard(name) && typeof content === "string" ? [content] : [],
      ),
    );
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    for (const [name, content] of files) {
      await (typeof content === "string"
        ? writeFile(new URL(name, outDir), content, "utf8")
        : writeFile(new URL(name, outDir), content));
    }
    next[id] = entry;
    await writeFile(manifestPath, serializeManifest(next), "utf8");
    const before = manifest.value[id]?.version ?? "none";
    console.log(
      `${id}: version ${before} -> ${entry.version}, rows +${String(diff.added)} / -${String(diff.removed)}, ${String(files.size)} files, ${summary}`,
    );
  }
};

main().catch((error: unknown) => {
  fail(`Pipeline crashed: ${String(error)}`);
});
