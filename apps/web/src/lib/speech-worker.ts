import type { SpeechModelIndex } from "@/data/format";
import { storedFile, url } from "@/data/speech-files";
import createSherpaOnnx, { type SherpaOnnx } from "./sherpa-onnx/sherpa-onnx-asr.mjs";

export type SpeechRequest =
  | { readonly type: "load"; readonly index: SpeechModelIndex }
  | {
      readonly type: "transcribe";
      readonly id: number;
      /** Mono, 16 kHz. */
      readonly samples: Float32Array<ArrayBuffer>;
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
};
const scope = self as unknown as Scope;

class MissingFile extends Error {}

type Engine = { readonly sherpa: SherpaOnnx; readonly recognizer: number };

let engine: Promise<Engine> | null = null;

/**
 * Starts sherpa-onnx with Paraformer from the Cache API filled after the learner's consent
 * (data/speech-model.ts), files joined from their parts: nothing is fetched (ADR 0007).
 */
const load = async (index: SpeechModelIndex): Promise<Engine> => {
  const files = new Map(index.files.map((file) => [file.path, file]));
  const read = async (path: string): Promise<Uint8Array> => {
    const file = files.get(path) ?? null;
    const response = file === null ? null : await storedFile(index, file);
    if (response === null) throw new MissingFile(`${url(path)} is not stored`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const errors: string[] = [];
  const sherpa = await createSherpaOnnx({
    wasmBinary: await read(index.runtime),
    print: () => {},
    printErr: (text) => {
      errors.push(text);
    },
  });
  sherpa.FS_createDataFile("/", "model.onnx", await read(index.model), true, false, true);
  sherpa.FS_createDataFile("/", "tokens.txt", await read(index.tokens), true, false, true);
  const model = sherpa.stringToNewUTF8("/model.onnx");
  const tokens = sherpa.stringToNewUTF8("/tokens.txt");
  const recognizer = sherpa._OpenLinguoCreateRecognizer(model, tokens);
  sherpa._free(model);
  sherpa._free(tokens);
  // The recognizer holds its own copy: the files would only take memory.
  sherpa.FS_unlink("/model.onnx");
  sherpa.FS_unlink("/tokens.txt");
  if (recognizer === 0) {
    throw new Error(errors.join("\n") || "sherpa-onnx could not load the model");
  }
  return { sherpa, recognizer };
};

const transcribe = ({ sherpa, recognizer }: Engine, samples: Float32Array): string => {
  const input = sherpa._malloc(samples.length * Float32Array.BYTES_PER_ELEMENT);
  if (input === 0) throw new Error("no memory for the recording");
  try {
    sherpa.HEAPF32.set(samples, input / Float32Array.BYTES_PER_ELEMENT);
    const text = sherpa._OpenLinguoTranscribe(recognizer, input, samples.length);
    if (text === 0) throw new Error("sherpa-onnx returned no transcript");
    try {
      return sherpa.UTF8ToString(text);
    } finally {
      sherpa._free(text);
    }
  } finally {
    sherpa._free(input);
  }
};

const fail = (stage: "load" | "transcribe", error: unknown): SpeechReply => ({
  type: "failed",
  stage,
  missing: error instanceof MissingFile,
  message: error instanceof Error ? error.message : String(error),
});

const handle = async (request: SpeechRequest): Promise<void> => {
  if (request.type === "load") {
    engine = load(request.index);
    try {
      await engine;
      scope.postMessage({ type: "loaded" });
    } catch (error) {
      engine = null;
      scope.postMessage(fail("load", error));
    }
    return;
  }
  try {
    if (engine === null) throw new Error("the model is not loaded");
    scope.postMessage({
      type: "transcript",
      id: request.id,
      text: transcribe(await engine, request.samples),
    });
  } catch (error) {
    scope.postMessage(fail("transcribe", error));
  }
};

// Registered before anything is awaited: a message sent while the module loads is not lost.
scope.onmessage = ({ data }) => {
  void handle(data);
};
