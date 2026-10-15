import { err, ok, type Result } from "@openlinguo/core";
import type { SpeechBackend, SpeechModelIndex } from "@/data/format";
import { storedFile } from "@/data/speech-files";
import { recordWebgpuVerdict, webgpuVerdict, type WebgpuVerdict } from "@/data/speech-model";
import { sameShare } from "@/data/transcript";
import type { SpeechReply, SpeechRequest } from "./speech-worker.ts";

const SAMPLE_RATE = 16_000;

export type RecognizerError =
  /** A model file is not stored: deleted from another tab, or the browser evicted it. */
  | { readonly kind: "missing" }
  /** WebGPU got the self-check sentence wrong on this device. */
  | { readonly kind: "unreliable" }
  | { readonly kind: "failed"; readonly message: string };

export type Recognizer = {
  readonly transcribe: (
    samples: Float32Array,
    sampleRate: number,
    maxTokens: number,
  ) => Promise<Result<string, RecognizerError>>;
  readonly close: () => void;
};

const failure = (reply: Extract<SpeechReply, { type: "failed" }>): RecognizerError =>
  reply.missing ? { kind: "missing" } : { kind: "failed", message: reply.message };

/** Whisper's input: mono at 16 kHz, resampled by the browser. */
export const resample = async (
  samples: Float32Array,
  sampleRate: number,
): Promise<Float32Array<ArrayBuffer>> => {
  if (sampleRate === SAMPLE_RATE) return new Float32Array(samples);
  const length = Math.max(1, Math.ceil((samples.length * SAMPLE_RATE) / sampleRate));
  const context = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const buffer = context.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(new Float32Array(samples), 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  return (await context.startRendering()).getChannelData(0);
};

/** Starts the speech worker and loads the stored model in it; one request at a time. */
export const startRecognizer = async (
  index: SpeechModelIndex,
  backend: SpeechBackend,
): Promise<Result<Recognizer, RecognizerError>> => {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./speech-worker.ts", import.meta.url), { type: "module" });
  } catch (error) {
    return err({ kind: "failed", message: String(error) });
  }
  const send = (request: SpeechRequest, transfer: Transferable[] = []): Promise<SpeechReply> =>
    new Promise((resolve) => {
      worker.onmessage = (event: MessageEvent<SpeechReply>) => {
        resolve(event.data);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        resolve({
          type: "failed",
          stage: request.type === "load" ? "load" : "transcribe",
          missing: false,
          message: event.message,
        });
      };
      worker.postMessage(request, transfer);
    });
  const loaded = await send({ type: "load", index, backend });
  if (loaded.type === "failed") {
    worker.terminate();
    return err(failure(loaded));
  }
  let next = 0;
  return ok({
    transcribe: async (samples, sampleRate, maxTokens) => {
      let input: Float32Array<ArrayBuffer>;
      try {
        input = await resample(samples, sampleRate);
      } catch (error) {
        return err({ kind: "failed", message: String(error) });
      }
      next += 1;
      const reply = await send({ type: "transcribe", id: next, samples: input, maxTokens }, [
        input.buffer,
      ]);
      if (reply.type === "failed") return err(failure(reply));
      return reply.type === "transcript"
        ? ok(reply.text)
        : err({ kind: "failed", message: reply.type });
    },
    close: () => {
      worker.terminate();
    },
  });
};

/** Below this share of the self-check sentence heard right, WebGPU is not trusted. */
const RIGHT_SHARE = 0.75;

/**
 * Transcribes the sentence stored with the model (`index.check`): some mobile GPUs give nonsense
 * in fp16 where WebAssembly is right (ADR 0007).
 */
export const checkRecognizer = async (
  recognizer: Recognizer,
  index: SpeechModelIndex,
): Promise<Result<WebgpuVerdict, RecognizerError>> => {
  const file = index.files.find(({ path }) => path === index.check.path) ?? null;
  const stored = file === null ? null : await storedFile(index, file);
  if (stored === null) return err({ kind: "missing" });
  let audio: AudioBuffer;
  try {
    audio = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(
      await stored.arrayBuffer(),
    );
  } catch (error) {
    return err({ kind: "failed", message: String(error) });
  }
  const heard = await recognizer.transcribe(
    audio.getChannelData(0),
    audio.sampleRate,
    2 * index.check.text.length + 10,
  );
  if (!heard.ok) return heard;
  return ok(sameShare(index.check.text, heard.value) >= RIGHT_SHARE ? "right" : "wrong");
};

export type TrustDependencies = {
  readonly start: typeof startRecognizer;
  readonly check: typeof checkRecognizer;
  readonly storage: () => Storage;
  readonly removeWebgpuFiles: (index: SpeechModelIndex) => Promise<unknown>;
};

/**
 * Starts the worker. On WebGPU the self-check sentence is transcribed first, once per release: if
 * it comes back wrong, WebGPU is set aside on this device and its files deleted, and the model
 * state then asks for the WebAssembly version.
 */
export const startTrusted = async (
  index: SpeechModelIndex,
  backend: SpeechBackend,
  { start, check, storage, removeWebgpuFiles }: TrustDependencies,
): Promise<Result<Recognizer, RecognizerError>> => {
  const started = await start(index, backend);
  if (!started.ok || backend !== "webgpu" || webgpuVerdict(storage, index) === "right") {
    return started;
  }
  const verdict = await check(started.value, index);
  if (verdict.ok) recordWebgpuVerdict(storage, index, verdict.value);
  if (verdict.ok && verdict.value === "right") return started;
  started.value.close();
  if (!verdict.ok) return verdict;
  await removeWebgpuFiles(index);
  return err({ kind: "unreliable" });
};
