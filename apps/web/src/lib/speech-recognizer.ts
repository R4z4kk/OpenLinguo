import { err, ok, type Result } from "@openlinguo/core";
import type { SpeechModelIndex } from "@/data/format";
import type { SpeechReply, SpeechRequest } from "./speech-worker.ts";

const SAMPLE_RATE = 16_000;

export type RecognizerError =
  /** A model file is not stored: deleted from another tab, or the browser evicted it. */
  { readonly kind: "missing" } | { readonly kind: "failed"; readonly message: string };

export type Recognizer = {
  readonly transcribe: (
    samples: Float32Array,
    sampleRate: number,
  ) => Promise<Result<string, RecognizerError>>;
  readonly close: () => void;
};

const failure = (reply: Extract<SpeechReply, { type: "failed" }>): RecognizerError =>
  reply.missing ? { kind: "missing" } : { kind: "failed", message: reply.message };

/** The recognizer's input: mono at 16 kHz, resampled by the browser. */
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
  const loaded = await send({ type: "load", index });
  if (loaded.type === "failed") {
    worker.terminate();
    return err(failure(loaded));
  }
  let next = 0;
  return ok({
    transcribe: async (samples, sampleRate) => {
      let input: Float32Array<ArrayBuffer>;
      try {
        input = await resample(samples, sampleRate);
      } catch (error) {
        return err({ kind: "failed", message: String(error) });
      }
      next += 1;
      const reply = await send({ type: "transcribe", id: next, samples: input }, [input.buffer]);
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

export type SharedRecognizer = {
  /** Starts the recognizer of this release if it is not running: on a phone it takes seconds. */
  readonly warm: (index: SpeechModelIndex) => void;
  readonly transcribe: (
    index: SpeechModelIndex,
    samples: Float32Array,
    sampleRate: number,
  ) => Promise<Result<string, RecognizerError>>;
  readonly close: () => void;
};

/**
 * One recognizer for the pages that use it, kept while the learner moves between them. A failure
 * stops it: the next use starts it again.
 */
export const shareRecognizer = (start: typeof startRecognizer): SharedRecognizer => {
  let current: {
    readonly release: string;
    readonly started: Promise<Result<Recognizer, RecognizerError>>;
  } | null = null;
  const close = (): void => {
    const closing = current;
    current = null;
    void closing?.started.then((started) => {
      if (started.ok) started.value.close();
    });
  };
  const started = (index: SpeechModelIndex): Promise<Result<Recognizer, RecognizerError>> => {
    if (current?.release === index.release) return current.started;
    close();
    const starting = { release: index.release, started: start(index) };
    current = starting;
    return starting.started;
  };
  return {
    warm: (index) => {
      void started(index);
    },
    transcribe: async (index, samples, sampleRate) => {
      const used = started(index);
      const recognizer = await used;
      const text = recognizer.ok
        ? await recognizer.value.transcribe(samples, sampleRate)
        : recognizer;
      if (!text.ok && current?.started === used) close();
      return text;
    },
    close,
  };
};

export const speechRecognizer: SharedRecognizer = shareRecognizer(startRecognizer);
