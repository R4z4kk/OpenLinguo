import { createHash } from "node:crypto";
import { z } from "zod";
import { dataDir } from "../manifest.ts";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const Dtype = z.enum(["fp32", "fp16", "q8", "q4"]);
export type Dtype = z.infer<typeof Dtype>;
const Backend = z.enum(["webgpu", "wasm"]);
export type Backend = z.infer<typeof Backend>;
const Dtypes = z.strictObject({ encoder_model: Dtype, decoder_model_merged: Dtype });
export type Dtypes = z.infer<typeof Dtypes>;

/** `data/whisper/model.json`: the speech-recognition files mirrored in a GitHub release (ADR 0007, #119). */
export const modelIndexSchema = z.strictObject({
  release: z.string().min(1),
  /** Hugging Face repository and revision the files are copied from, byte for byte. */
  model: z.string().regex(/^[\w.-]+\/[\w.-]+$/u),
  revision: z.string().regex(/^[0-9a-f]{40}$/u),
  license: z.literal("MIT"),
  backends: z.partialRecord(Backend, Dtypes),
  files: z.array(
    z.strictObject({
      path: z.string().min(1),
      bytes: z.number().int().positive(),
      sha256,
      /** Backends that load the file; absent for the configuration and tokenizer files they share. */
      backends: z.array(Backend).min(1).optional(),
    }),
  ),
});
export type ModelIndex = z.infer<typeof modelIndexSchema>;

export const WHISPER_DATASET = "whisper";
export const modelIndexPath = new URL("whisper/model.json", dataDir);

/** File suffixes of transformers.js 4.3.1 (`DEFAULT_DTYPE_SUFFIX_MAPPING`). */
const SUFFIX: Record<Dtype, string> = { fp32: "", fp16: "_fp16", q8: "_quantized", q4: "_q4" };

export const SHARED_FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
] as const;

/** Every file the backends load, each ONNX file once with the backends that need it. */
export const modelFiles = (
  backends: Partial<Record<Backend, Dtypes>>,
): { readonly path: string; readonly backends: readonly Backend[] | null }[] => {
  const onnx = new Map<string, Backend[]>();
  for (const [backend, dtypes] of Object.entries(backends) as [Backend, Dtypes][]) {
    for (const [session, dtype] of Object.entries(dtypes) as [keyof Dtypes, Dtype][]) {
      const path = `onnx/${session}${SUFFIX[dtype]}.onnx`;
      onnx.set(path, [...(onnx.get(path) ?? []), backend]);
    }
  }
  return [
    ...SHARED_FILES.map((path) => ({ path, backends: null })),
    ...[...onnx].map(([path, users]) => ({ path, backends: users })),
  ];
};

/** Git's object id of a file, which the Hugging Face API gives for files not stored in LFS. */
export const gitBlobSha1 = (bytes: Uint8Array): string =>
  createHash("sha1")
    .update(`blob ${String(bytes.length)}\0`)
    .update(bytes)
    .digest("hex");

/** GitHub release assets are flat: each file is attached under its base name. */
export const assetName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
