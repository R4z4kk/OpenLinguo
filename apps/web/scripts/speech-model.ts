// Fetches the speech-recognition model and the sherpa-onnx WebAssembly binary named in data/paraformer/model.json
// from their GitHub release, checks each file against its sha256, and publishes them in public/models/ with the
// index the app reads. Pages serves files up to 25 MiB: larger ones are cut into parts the worker joins again
// (ADR 0007, #119).
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { SpeechModelFile, SpeechModelIndex } from "../src/data/format.ts";
import { DATA } from "./sources.ts";

const CACHE = new URL("../.cache/paraformer/", import.meta.url);
const OUT = new URL("../public/models/", import.meta.url);
const GLUE = new URL("../src/lib/sherpa-onnx/", import.meta.url);
const RELEASES = "https://github.com/R4z4kk/OpenLinguo/releases/download";
const DATASET = "paraformer";
/** Pages serves files up to 25 MiB (developers.cloudflare.com/pages/platform/limits, checked 2026-10-14). */
export const PART_BYTES = 20 * 1024 * 1024;
const MODEL = "model.int8.onnx";
const TOKENS = "tokens.txt";
const RUNTIME = "sherpa-onnx-asr.wasm";

const Manifest = z.record(z.string(), z.looseObject({ sha256: z.string() }));
const File = z.object({
  path: z.string().regex(/^[\w.-]+$/u),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
});
/** The fields of `data/paraformer/model.json` the app needs; the pipeline owns the full schema. */
const ModelFile = z.looseObject({
  release: z.string().min(1),
  model: z.string().regex(/^[\w.-]+\/[\w.-]+$/u),
  runtime: z.looseObject({ glue: File }),
  files: z.array(File),
});

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const readCached = async (file: URL, hash: string): Promise<Uint8Array | null> => {
  try {
    const bytes = new Uint8Array(await readFile(file));
    return sha256(bytes) === hash ? bytes : null;
  } catch {
    return null;
  }
};

const download = async (url: string, file: URL, hash: string): Promise<Uint8Array> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== hash) {
    throw new Error(`${url} does not match its sha256 in data/${DATASET}/model.json`);
  }
  await writeFile(file, bytes);
  return bytes;
};

/** Writes a file whole, or in parts of `PART_BYTES` named `<path>.<n>` when it is larger. */
const publish = async (path: string, bytes: Uint8Array): Promise<SpeechModelFile> => {
  const target = new URL(path, OUT);
  await mkdir(new URL(".", target), { recursive: true });
  const file = { path, bytes: bytes.length, sha256: sha256(bytes) };
  if (bytes.length <= PART_BYTES) {
    await writeFile(target, bytes);
    return file;
  }
  const parts: NonNullable<SpeechModelFile["parts"]> = [];
  for (let start = 0; start < bytes.length; start += PART_BYTES) {
    const part = bytes.subarray(start, start + PART_BYTES);
    const partPath = `${path}.${String(parts.length)}`;
    await writeFile(new URL(partPath, OUT), part);
    parts.push({ path: partPath, bytes: part.length, sha256: sha256(part) });
  }
  return { ...file, parts };
};

/** Publishes the model in `public/models/`; a file missing or not matching its sha256 stops the build. */
export const publishSpeechModel = async (): Promise<string> => {
  const indexBytes = new Uint8Array(await readFile(new URL(`${DATASET}/model.json`, DATA)));
  const manifest = Manifest.parse(
    JSON.parse(await readFile(new URL("manifest.json", DATA), "utf8")) as unknown,
  );
  if (manifest[DATASET]?.sha256 !== sha256(indexBytes)) {
    throw new Error(`data/${DATASET}/model.json does not match its sha256 in data/manifest.json`);
  }
  const { release, model, runtime, files } = ModelFile.parse(
    JSON.parse(new TextDecoder().decode(indexBytes)) as unknown,
  );
  // The JavaScript is bundled in the worker: it must come from the build of the binary served.
  if ((await readCached(new URL(runtime.glue.path, GLUE), runtime.glue.sha256)) === null) {
    throw new Error(
      `src/lib/sherpa-onnx/${runtime.glue.path} does not match its sha256 in data/${DATASET}/model.json`,
    );
  }
  const directory = model.slice(model.indexOf("/") + 1);
  const cache = new URL(`${release}/`, CACHE);
  await mkdir(cache, { recursive: true });
  await rm(OUT, { recursive: true, force: true });
  const served: SpeechModelFile[] = [];
  for (const { path, sha256: hash } of files) {
    const cached = new URL(path, cache);
    const bytes =
      (await readCached(cached, hash)) ??
      (await download(`${RELEASES}/${release}/${path}`, cached, hash));
    served.push(
      await publish(path === RUNTIME ? `sherpa-onnx/${path}` : `${directory}/${path}`, bytes),
    );
  }
  const index: SpeechModelIndex = {
    release,
    model: `${directory}/${MODEL}`,
    tokens: `${directory}/${TOKENS}`,
    runtime: `sherpa-onnx/${RUNTIME}`,
    files: served,
  };
  for (const path of [index.model, index.tokens, index.runtime]) {
    if (!served.some((file) => file.path === path)) {
      throw new Error(`data/${DATASET}/model.json has no ${path}`);
    }
  }
  await writeFile(new URL("index.json", OUT), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  const total = served.reduce((sum, file) => sum + file.bytes, 0);
  return `models: ${model} and sherpa-onnx, ${(total / 1_048_576).toFixed(1)} MiB in ${String(served.length)} files from release ${release}, downloaded on request`;
};
