import { mkdir, rm, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { ccCedict } from "./datasets/cc-cedict.ts";
import { readManifest, serializeManifest, type ManifestError } from "./manifest.ts";
import { fetchBytes, formatError, runDataset, type Dataset } from "./run.ts";

const datasets: ReadonlyMap<string, Dataset> = new Map([[ccCedict.id, ccCedict]]);

const dataDir = new URL("../../../data/", import.meta.url);
const manifestPath = new URL("manifest.json", dataDir);

const fail = (message: string): void => {
  console.error(message);
  process.exitCode = 1;
};

const formatManifestError = (error: ManifestError): string =>
  error.kind === "manifest-unreadable"
    ? `Cannot read data/manifest.json: ${error.message}`
    : `Invalid data/manifest.json: ${error.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`;

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
    });
    if (!result.ok) {
      fail(formatError(result.error));
      return;
    }
    const outDir = new URL(`${id}/`, dataDir);
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    for (const [name, content] of result.value.files) {
      await writeFile(new URL(name, outDir), content, "utf8");
    }
    next[id] = result.value.entry;
    await writeFile(manifestPath, serializeManifest(next), "utf8");
    console.log(
      `${id}: ${String(result.value.files.size)} files, version ${result.value.entry.version}`,
    );
  }
};

main().catch((error: unknown) => {
  fail(`Pipeline crashed: ${String(error)}`);
});
