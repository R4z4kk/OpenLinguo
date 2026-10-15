// Mirrors the speech-recognition model and runtime (ADR 0007, #119): the pinned sherpa-onnx Paraformer-small files,
// byte for byte, checked against the hashes Hugging Face publishes, and the WebAssembly build of tools/sherpa-onnx,
// checked against its SHA256SUMS. Writes data/paraformer/ and its manifest entry, commits the build's JavaScript in
// apps/web, and prints the upload command for the release.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { formatManifestError, manifestPath, readManifest, serializeManifest } from "../manifest.ts";
import {
  BUILD,
  buildInfoSchema,
  datasetDir,
  gitBlobSha1,
  MODEL_FILES,
  PARAFORMER_DATASET,
  parseSums,
  type ModelIndex,
} from "./paraformer-model.ts";

/** Chosen by the benchmark recorded in ADR 0007. */
const MODEL = "csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09";
const REVISION = "63ddc3cd0f2810b68289a7b3876e62ef5d53d6df";
/** Bump for every change: release assets are immutable once the app points to them. */
const RELEASE = "paraformer-1";
const RELEASE_URL = `https://github.com/R4z4kk/OpenLinguo/releases/tag/${RELEASE}`;

const outDir = new URL(`../../../asr/.mirror/${RELEASE}/`, import.meta.url);
const buildDir = new URL("../../../sherpa-onnx/out/", import.meta.url);
const glueTarget = new URL(
  `../../../../apps/web/src/lib/sherpa-onnx/${BUILD.glue}`,
  import.meta.url,
);

class MirrorError extends Error {}

const TreeEntry = z.looseObject({
  type: z.string(),
  path: z.string(),
  oid: z.string(),
  lfs: z.looseObject({ oid: z.string() }).optional(),
});

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Expected hash per path: `sha256:` for LFS files, `sha1:` (git blob id) for the others. */
const expectedHashes = async (): Promise<ReadonlyMap<string, string>> => {
  const url = `https://huggingface.co/api/models/${MODEL}/tree/${REVISION}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new MirrorError(`${url}: HTTP ${String(response.status)}`);
  const tree = z.array(TreeEntry).parse(await response.json());
  return new Map(
    tree
      .filter(({ type }) => type === "file")
      .map((entry) => [entry.path, entry.lfs ? `sha256:${entry.lfs.oid}` : `sha1:${entry.oid}`]),
  );
};

const matches = (bytes: Uint8Array, expected: string): boolean =>
  expected === `sha256:${sha256(bytes)}` || expected === `sha1:${gitBlobSha1(bytes)}`;

const download = async (path: string, expected: string): Promise<Uint8Array> => {
  const target = new URL(path, outDir);
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

/** A build output file, refused unless it matches the build's SHA256SUMS. */
const built = async (sums: ReadonlyMap<string, string>, name: string): Promise<Uint8Array> => {
  const bytes = new Uint8Array(await readFile(new URL(name, buildDir)));
  if (sums.get(name) !== sha256(bytes)) {
    throw new MirrorError(`tools/sherpa-onnx/out/${name} does not match its SHA256SUMS`);
  }
  return bytes;
};

const entry = (path: string, bytes: Uint8Array): ModelIndex["files"][number] => ({
  path,
  bytes: bytes.length,
  sha256: sha256(bytes),
});

const main = async (): Promise<void> => {
  const manifest = await readManifest(manifestPath);
  if (!manifest.ok) throw new MirrorError(formatManifestError(manifest.error));
  let sums: ReadonlyMap<string, string>;
  try {
    sums = parseSums(await readFile(new URL(BUILD.sums, buildDir), "utf8"));
  } catch (error) {
    throw new MirrorError(
      `no sherpa-onnx build (docker build --output type=local,dest=tools/sherpa-onnx/out tools/sherpa-onnx): ${String(error)}`,
    );
  }
  const info = buildInfoSchema.parse(
    JSON.parse(new TextDecoder().decode(await built(sums, BUILD.info))) as unknown,
  );
  const glue = await built(sums, BUILD.glue);
  const binary = await built(sums, BUILD.binary);
  const licenses = await built(sums, BUILD.licenses);

  const hashes = await expectedHashes();
  await mkdir(outDir, { recursive: true });
  const files: ModelIndex["files"][number][] = [];
  for (const path of MODEL_FILES) {
    const expected = hashes.get(path) ?? null;
    if (expected === null) throw new MirrorError(`${MODEL}@${REVISION} has no ${path}`);
    const bytes = await download(path, expected);
    files.push(entry(path, bytes));
    console.log(`${path}: ${(bytes.length / 1_048_576).toFixed(1)} MiB`);
  }
  await writeFile(new URL(BUILD.binary, outDir), binary);
  files.push(entry(BUILD.binary, binary));

  await mkdir(new URL(".", glueTarget), { recursive: true });
  await copyFile(new URL(BUILD.glue, buildDir), glueTarget);
  await mkdir(datasetDir, { recursive: true });
  await writeFile(new URL(BUILD.licenses, datasetDir), licenses);
  const index: ModelIndex = {
    release: RELEASE,
    model: MODEL,
    revision: REVISION,
    license: "Apache-2.0",
    runtime: { ...info, glue: entry(BUILD.glue, glue) },
    files,
  };
  const json = `${JSON.stringify(index, null, 2)}\n`;
  await writeFile(new URL("model.json", datasetDir), json);
  await writeFile(
    manifestPath,
    serializeManifest({
      ...manifest.value,
      [PARAFORMER_DATASET]: {
        source: RELEASE_URL,
        license: "Apache-2.0",
        version: `${RELEASE}: ${MODEL}@${REVISION}, sherpa-onnx ${info.sherpaOnnx} (ONNX Runtime ${info.onnxruntime}, Emscripten ${info.emscripten})`,
        retrievedAt: new Date().toISOString(),
        maxAgeDays: 365,
        sha256: sha256(new TextEncoder().encode(json)),
      },
    }),
  );
  const assets = files.map(({ path }) => fileURLToPath(new URL(path, outDir)));
  console.log(`Upload: gh release create ${RELEASE} --title ${RELEASE} ${assets.join(" ")}`);
};

main().catch((error: unknown) => {
  console.error(`paraformer: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
