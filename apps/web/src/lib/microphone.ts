import { err, ok, type Result } from "@openlinguo/core";
import workletUrl from "./capture-worklet.ts?worker&url";

export type MicrophoneError =
  | { readonly kind: "unsupported" }
  | { readonly kind: "denied" }
  | { readonly kind: "no-device" }
  | { readonly kind: "busy" }
  | { readonly kind: "failed"; readonly message: string };

export type Microphone = {
  readonly sampleRate: number;
  /** Stops the tracks (the browser's recording indicator goes off) and closes the audio graph. */
  readonly release: () => void;
};

/** Pitch needs the raw voice: echo cancellation, noise suppression and gain control reshape it. */
const CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
};

const failure = (error: unknown): MicrophoneError => {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return { kind: "denied" };
  if (name === "NotFoundError" || name === "OverconstrainedError") return { kind: "no-device" };
  if (name === "NotReadableError" || name === "AbortError") return { kind: "busy" };
  return { kind: "failed", message: String(error) };
};

/**
 * Opens the microphone and hands each block of samples to `onSamples`, on the device only. Call it
 * from the user's action: the audio context is created before the first await so that Safari lets
 * it run.
 */
export const openMicrophone = async (
  onSamples: (samples: Float32Array) => void,
): Promise<Result<Microphone, MicrophoneError>> => {
  // Both are missing outside a secure context or in old browsers, whatever the types say.
  if (!("mediaDevices" in navigator) || typeof AudioWorkletNode !== "function") {
    return err({ kind: "unsupported" });
  }
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch (error) {
    return err(failure(error));
  }
  let stream: MediaStream | null = null;
  const release = (): void => {
    for (const track of stream?.getTracks() ?? []) track.stop();
    if (context.state !== "closed") void context.close();
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    await context.audioWorklet.addModule(workletUrl);
    const capture = new AudioWorkletNode(context, "capture");
    capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
      onSamples(event.data);
    };
    context.createMediaStreamSource(stream).connect(capture).connect(context.destination);
    await context.resume();
    return ok({ sampleRate: context.sampleRate, release });
  } catch (error) {
    release();
    return err(failure(error));
  }
};
