// Mirrors the speech-recognition model (ADR 0007, #119): the pinned onnx-community Whisper files, byte for byte,
// checked against the hashes Hugging Face publishes (sha256 for LFS files, git blob id for the others).
// Writes data/whisper/model.json and its manifest entry, and prints the upload command for the release.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { formatManifestError, manifestPath, readManifest, serializeManifest } from "../manifest.ts";
import {
  assetName,
  gitBlobSha1,
  modelFiles,
  modelIndexPath,
  WHISPER_DATASET,
  type Backend,
  type Dtypes,
  type ModelIndex,
} from "./whisper-model.ts";

/** Chosen by the benchmark recorded in ADR 0007. */
const MODEL = "onnx-community/whisper-base";
const REVISION = "1846881b6b3a3024392c1eea3ad983695bc23925";
const BACKENDS: Partial<Record<Backend, Dtypes>> = {
  webgpu: { encoder_model: "fp16", decoder_model_merged: "fp16" },
  wasm: { encoder_model: "q8", decoder_model_merged: "q8" },
};
/** Bump for every change: release assets are immutable once the app points to them. */
const RELEASE = "whisper-1";
const RELEASE_URL = `https://github.com/R4z4kk/OpenLinguo/releases/tag/${RELEASE}`;

const outDir = new URL(`../../../asr/.mirror/${RELEASE}/`, import.meta.url);

class MirrorError extends Error {}

const TreeEntry = z.looseObject({
  type: z.string(),
  path: z.string(),
  oid: z.string(),
  lfs: z.looseObject({ oid: z.string() }).optional(),
});

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const getJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new MirrorError(`${url}: HTTP ${String(response.status)}`);
  return response.json();
};

/** Expected hash per path: `sha256:` for LFS files, `sha1:` (git blob id) for the others. */
const expectedHashes = async (): Promise<ReadonlyMap<string, string>> => {
  const hashes = new Map<string, string>();
  for (const dir of ["", "onnx"]) {
    const url = `https://huggingface.co/api/models/${MODEL}/tree/${REVISION}/${dir}`;
    const tree = z.array(TreeEntry).parse(await getJson(url));
    for (const entry of tree.filter(({ type }) => type === "file")) {
      hashes.set(entry.path, entry.lfs ? `sha256:${entry.lfs.oid}` : `sha1:${entry.oid}`);
    }
  }
  return hashes;
};

const matches = (bytes: Uint8Array, expected: string): boolean =>
  expected === `sha256:${sha256(bytes)}` || expected === `sha1:${gitBlobSha1(bytes)}`;

const download = async (path: string, expected: string): Promise<Uint8Array> => {
  const target = new URL(assetName(path), outDir);
  try {
    const cached = new Uint8Array(await readFile(target));
    if (matches(cached, expected)) return cached;
  } catch {
    // Not downloaded yet.
  }
  const url = `https://huggingface.co/${MODEL}/resolve/${REVISION}/${path}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30 * 60_000) });
  if (!response.ok) throw new MirrorError(`${url}: HTTP ${String(response.status)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!matches(bytes, expected)) throw new MirrorError(`${url} does not match ${expected}`);
  const temporary = new URL(`${target.href}.tmp`);
  await writeFile(temporary, bytes);
  await rename(temporary, target);
  return bytes;
};

const main = async (): Promise<void> => {
  const manifest = await readManifest(manifestPath);
  if (!manifest.ok) throw new MirrorError(formatManifestError(manifest.error));
  const hashes = await expectedHashes();
  await mkdir(outDir, { recursive: true });
  const files: ModelIndex["files"][number][] = [];
  for (const { path, backends } of modelFiles(BACKENDS)) {
    const expected = hashes.get(path) ?? null;
    if (expected === null) throw new MirrorError(`${MODEL}@${REVISION} has no ${path}`);
    const bytes = await download(path, expected);
    files.push({
      path,
      bytes: bytes.length,
      sha256: sha256(bytes),
      ...(backends ? { backends: [...backends] } : {}),
    });
    console.log(`${path}: ${(bytes.length / 1_048_576).toFixed(1)} MiB`);
  }
  const index: ModelIndex = {
    release: RELEASE,
    model: MODEL,
    revision: REVISION,
    license: "MIT",
    backends: BACKENDS,
    files,
  };
  const json = `${JSON.stringify(index, null, 2)}\n`;
  await mkdir(new URL(".", modelIndexPath), { recursive: true });
  await writeFile(modelIndexPath, json);
  await writeFile(
    manifestPath,
    serializeManifest({
      ...manifest.value,
      [WHISPER_DATASET]: {
        source: RELEASE_URL,
        license: "MIT",
        version: `${RELEASE}: ${MODEL}@${REVISION}`,
        retrievedAt: new Date().toISOString(),
        maxAgeDays: 365,
        sha256: sha256(new TextEncoder().encode(json)),
      },
    }),
  );
  const assets = files.map(({ path }) => fileURLToPath(new URL(assetName(path), outDir)));
  console.log(`Upload: gh release create ${RELEASE} --title ${RELEASE} ${assets.join(" ")}`);
};

main().catch((error: unknown) => {
  console.error(`whisper: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
