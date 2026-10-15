import type { AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import type { SpeechBackend, SpeechModelIndex } from "@/data/format";
import { storedFile, url } from "@/data/speech-files";

export type SpeechRequest =
  | {
      readonly type: "load";
      readonly index: SpeechModelIndex;
      readonly backend: SpeechBackend;
    }
  | {
      readonly type: "transcribe";
      readonly id: number;
      /** Mono, 16 kHz. */
      readonly samples: Float32Array<ArrayBuffer>;
      /** Caps a runaway transcript: Whisper can repeat a token until its limit. */
      readonly maxTokens: number;
    };

export type SpeechReply =
  | { readonly type: "loaded" }
  | { readonly type: "transcript"; readonly id: number; readonly text: string }
  | {
      readonly type: "failed";
      readonly stage: "load" | "transcribe";
      /** A model file is not in the Cache API: the model was deleted or never fully downloaded. */
      readonly missing: boolean;
      readonly message: string;
    };

type Scope = {
  onmessage: ((event: MessageEvent<SpeechRequest>) => void) | null;
  postMessage: (message: SpeechReply) => void;
  readonly location: Location;
};
const scope = self as unknown as Scope;

class MissingFile extends Error {}

let recognizer: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

/**
 * Loads transformers.js from our origin only: model files come from the Cache API filled after the
 * learner's consent (data/speech-model.ts), joined from their parts; the runtime binary too, passed
 * as `wasmBinary` so that its JavaScript, bundled here, needs no `blob:` script (ADR 0007).
 */
const load = async (
  index: SpeechModelIndex,
  backend: SpeechBackend,
): Promise<AutomaticSpeechRecognitionPipeline> => {
  const config = index.backends[backend] ?? null;
  if (config === null) throw new Error(`no ${backend} model in ${url("index.json")}`);
  const files = new Map(index.files.map((file) => [url(file.path), file]));
  const read = async (path: string): Promise<Response> => {
    const file = files.get(path) ?? null;
    const response = file === null ? null : await storedFile(index, file);
    if (response === null) throw new MissingFile(`${path} is not stored`);
    return response;
  };
  const { env, pipeline } = await import("@huggingface/transformers");
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = url("");
  env.useBrowserCache = false;
  env.useWasmCache = false;
  env.fetch = (input: string | URL) => read(new URL(input, scope.location.href).pathname);
  const wasm = env.backends.onnx.wasm ?? null;
  if (wasm === null) throw new Error("transformers.js has no WebAssembly backend");
  wasm.wasmBinary = await (await read(url(config.runtime))).arrayBuffer();
  // No `mjs`: ONNX Runtime uses the factory bundled with it instead of importing one.
  wasm.wasmPaths = { wasm: url(config.runtime) };
  wasm.numThreads = 1;
  return pipeline("automatic-speech-recognition", index.model, {
    device: backend,
    dtype: config.dtype,
  });
};

const fail = (stage: "load" | "transcribe", error: unknown): SpeechReply => ({
  type: "failed",
  stage,
  missing: error instanceof MissingFile,
  message: error instanceof Error ? error.message : String(error),
});

const handle = async (request: SpeechRequest): Promise<void> => {
  if (request.type === "load") {
    recognizer = load(request.index, request.backend);
    try {
      await recognizer;
      scope.postMessage({ type: "loaded" });
    } catch (error) {
      recognizer = null;
      scope.postMessage(fail("load", error));
    }
    return;
  }
  try {
    if (recognizer === null) throw new Error("the model is not loaded");
    const output = await (
      await recognizer
    )(request.samples, {
      language: "chinese",
      task: "transcribe",
      max_new_tokens: request.maxTokens,
    });
    scope.postMessage({ type: "transcript", id: request.id, text: output.text });
  } catch (error) {
    scope.postMessage(fail("transcribe", error));
  }
};

// Registered before anything is awaited: a message sent while the module loads is not lost.
scope.onmessage = ({ data }) => {
  void handle(data);
};
