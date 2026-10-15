import { createHash } from "node:crypto";
import { z } from "zod";
import { dataDir } from "../manifest.ts";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const File = z.strictObject({
  path: z.string().regex(/^[\w.-]+$/u),
  bytes: z.number().int().positive(),
  sha256,
});

/** `build.json`, written by tools/sherpa-onnx/Dockerfile next to the binary. */
export const buildInfoSchema = z.strictObject({
  sherpaOnnx: z.string().regex(/^v\d+\.\d+\.\d+$/u),
  commit: z.string().regex(/^[0-9a-f]{40}$/u),
  onnxruntime: z.string().regex(/^\d+\.\d+\.\d+$/u),
  emscripten: z.string().regex(/^\d+\.\d+\.\d+$/u),
});

/** `data/paraformer/model.json`: the speech-recognition files mirrored in a GitHub release (ADR 0007, #119). */
export const modelIndexSchema = z.strictObject({
  release: z.string().min(1),
  /** Hugging Face repository and revision the model files are copied from, byte for byte. */
  model: z.string().regex(/^[\w.-]+\/[\w.-]+$/u),
  revision: z.string().regex(/^[0-9a-f]{40}$/u),
  license: z.literal("Apache-2.0"),
  /** tools/sherpa-onnx's build; its JavaScript is committed in apps/web, its binary is in `files`. */
  runtime: buildInfoSchema.extend({ glue: File }),
  files: z.array(File),
});
export type ModelIndex = z.infer<typeof modelIndexSchema>;

export const PARAFORMER_DATASET = "paraformer";
export const datasetDir = new URL(`${PARAFORMER_DATASET}/`, dataDir);
export const MODEL_FILES = ["model.int8.onnx", "tokens.txt"] as const;
/** tools/sherpa-onnx/out/ */
export const BUILD = {
  glue: "sherpa-onnx-asr.mjs",
  binary: "sherpa-onnx-asr.wasm",
  info: "build.json",
  licenses: "THIRD-PARTY-LICENSES.txt",
  sums: "SHA256SUMS",
} as const;

/** `sha256sum` output: file name to hash. */
export const parseSums = (text: string): ReadonlyMap<string, string> =>
  new Map(
    text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const match = /^([0-9a-f]{64}) [ *](\S+)$/u.exec(line.trim());
        if (match === null) throw new Error(`not a sha256sum line: ${line}`);
        return [match[2] ?? "", match[1] ?? ""] as const;
      }),
  );

/** Git's object id of a file, which the Hugging Face API gives for files not stored in LFS. */
export const gitBlobSha1 = (bytes: Uint8Array): string =>
  createHash("sha1")
    .update(`blob ${String(bytes.length)}\0`)
    .update(bytes)
    .digest("hex");
