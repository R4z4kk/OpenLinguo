// Fetches the speech-recognition model named in data/whisper/model.json from its GitHub release, checks each file
// against its sha256, adds the ONNX Runtime WebAssembly binary pinned by @huggingface/transformers, and publishes
// them in public/models/ with the index the app reads. Pages serves files up to 25 MiB: larger ones are cut into
// parts the worker joins again (ADR 0007, #119).
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { SpeechBackend, type SpeechModelFile, type SpeechModelIndex } from "../src/data/format.ts";
import { DATA } from "./sources.ts";

const CACHE = new URL("../.cache/whisper/", import.meta.url);
const OUT = new URL("../public/models/", import.meta.url);
const RELEASES = "https://github.com/R4z4kk/OpenLinguo/releases/download";
const DATASET = "whisper";
/** Pages serves files up to 25 MiB (developers.cloudflare.com/pages/platform/limits, checked 2026-10-14). */
export const PART_BYTES = 20 * 1024 * 1024;
/** ONNX Runtime's WebAssembly and WebGPU build: its JavaScript is bundled with transformers.js, not served. */
const RUNTIME = "ort-wasm-simd-threaded.asyncify.wasm";
/**
 * A sentence the worker transcribes once on WebGPU before trusting it: some mobile GPUs give
 * nonsense in fp16 (ADR 0007). MOSS-TTS, synthetic voice, CC0 like the audio packs.
 */
const SELF_CHECK = { file: "self-check.wav", text: "我们一起去吃饭吧" } as const;

const Manifest = z.record(z.string(), z.looseObject({ sha256: z.string() }));
const Dtype = z.enum(["fp32", "fp16", "q8", "q4"]);
/** The fields of `data/whisper/model.json` the app needs; the pipeline owns the full schema. */
const ModelFile = z.looseObject({
  release: z.string().min(1),
  model: z.string().regex(/^[\w.-]+\/[\w.-]+$/u),
  backends: z.partialRecord(
    SpeechBackend,
    z.object({ encoder_model: Dtype, decoder_model_merged: Dtype }),
  ),
  files: z.array(
    z.object({
      path: z.string().regex(/^[\w./-]+$/u),
      bytes: z.number().int().positive(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      backends: z.array(SpeechBackend).min(1).optional(),
    }),
  ),
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

/** The runtime binary from the onnxruntime-web version transformers.js depends on, refused if another is installed. */
const runtimeBinary = async (): Promise<Uint8Array> => {
  const require = createRequire(import.meta.url);
  // The package's CommonJS entry is dist/transformers.node.cjs.
  const root = dirname(dirname(require.resolve("@huggingface/transformers")));
  const transformers = z
    .object({ dependencies: z.object({ "onnxruntime-web": z.string() }) })
    .parse(JSON.parse(await readFile(join(root, "package.json"), "utf8")) as unknown);
  const wasm = createRequire(join(root, "package.json")).resolve(`onnxruntime-web/${RUNTIME}`);
  const ort = z
    .object({ version: z.string() })
    .parse(
      JSON.parse(await readFile(join(dirname(wasm), "..", "package.json"), "utf8")) as unknown,
    );
  if (ort.version !== transformers.dependencies["onnxruntime-web"]) {
    throw new Error(
      `onnxruntime-web ${ort.version} is installed, transformers.js pins ${transformers.dependencies["onnxruntime-web"]}`,
    );
  }
  return new Uint8Array(await readFile(pathToFileURL(wasm)));
};

/** Writes a file whole, or in parts of `PART_BYTES` named `<path>.<n>` when it is larger. */
const publish = async (
  path: string,
  bytes: Uint8Array,
  backends: readonly SpeechBackend[] | null,
): Promise<SpeechModelFile> => {
  const target = new URL(path, OUT);
  await mkdir(new URL(".", target), { recursive: true });
  const file = {
    path,
    bytes: bytes.length,
    sha256: sha256(bytes),
    ...(backends === null ? {} : { backends: [...backends] }),
  };
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
  const { release, model, backends, files } = ModelFile.parse(
    JSON.parse(new TextDecoder().decode(indexBytes)) as unknown,
  );
  const directory = model.slice(model.indexOf("/") + 1);
  const cache = new URL(`${release}/`, CACHE);
  await mkdir(cache, { recursive: true });
  await rm(OUT, { recursive: true, force: true });
  const served: SpeechModelFile[] = [];
  for (const { path, sha256: hash, backends: users } of files) {
    const asset = path.slice(path.lastIndexOf("/") + 1);
    const cached = new URL(asset, cache);
    const bytes =
      (await readCached(cached, hash)) ??
      (await download(`${RELEASES}/${release}/${asset}`, cached, hash));
    served.push(await publish(`${directory}/${path}`, bytes, users ?? null));
  }
  const runtime = `ort/${RUNTIME}`;
  served.push(await publish(runtime, await runtimeBinary(), null));
  const check = `${directory}/${SELF_CHECK.file}`;
  served.push(
    await publish(
      check,
      new Uint8Array(await readFile(new URL(`${DATASET}/${SELF_CHECK.file}`, DATA))),
      ["webgpu"],
    ),
  );
  const index: SpeechModelIndex = {
    release,
    model: directory,
    backends: {
      ...(backends.webgpu ? { webgpu: { dtype: backends.webgpu, runtime } } : {}),
      ...(backends.wasm ? { wasm: { dtype: backends.wasm, runtime } } : {}),
    },
    files: served,
    check: { path: check, text: SELF_CHECK.text },
  };
  await writeFile(new URL("index.json", OUT), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  const total = served.reduce((sum, file) => sum + file.bytes, 0);
  return `models: ${model} (${Object.keys(backends).join(", ")}), ${(total / 1_048_576).toFixed(1)} MiB in ${String(served.length)} files from release ${release}, downloaded on request`;
};
