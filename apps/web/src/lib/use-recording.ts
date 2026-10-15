import { useCallback, useEffect, useRef, useState } from "react";
import { openMicrophone, type Microphone, type MicrophoneError } from "./microphone.ts";
import { joinSamples, speechEnded } from "./recording.ts";

const TICK_MS = 100;

export type RecordingPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "opening" }
  | { readonly kind: "recording" }
  | { readonly kind: "failed"; readonly error: MicrophoneError | { readonly kind: "interrupted" } };

type Active = {
  readonly microphone: Microphone;
  readonly blocks: Float32Array[];
  readonly timer: number;
};

/**
 * Records until the speaker stops, `maxSeconds` pass or `stop` is called, then hands the samples to
 * `onRecorded`. The microphone is open only while recording; hiding the page drops the recording.
 */
export const useRecording = (
  maxSeconds: number,
  onRecorded: (samples: Float32Array, sampleRate: number) => void,
): {
  readonly phase: RecordingPhase;
  readonly start: () => Promise<void>;
  readonly stop: () => void;
} => {
  const [phase, setPhase] = useState<RecordingPhase>({ kind: "idle" });
  const active = useRef<Active | null>(null);
  const opening = useRef(false);
  const mounted = useRef(true);
  const done = useRef(onRecorded);
  done.current = onRecorded;

  const close = useCallback((): Float32Array | null => {
    const current = active.current;
    if (current === null) return null;
    active.current = null;
    window.clearInterval(current.timer);
    current.microphone.release();
    return joinSamples(current.blocks.splice(0));
  }, []);

  const finish = useCallback(
    (sampleRate: number): void => {
      const samples = close();
      if (samples === null) return;
      setPhase({ kind: "idle" });
      done.current(samples, sampleRate);
    },
    [close],
  );

  useEffect(() => {
    mounted.current = true;
    const onHidden = (): void => {
      if (document.visibilityState === "hidden" && close() !== null) {
        setPhase({ kind: "failed", error: { kind: "interrupted" } });
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onHidden);
      close();
    };
  }, [close]);

  const start = useCallback(async (): Promise<void> => {
    if (active.current !== null || opening.current) return;
    opening.current = true;
    setPhase({ kind: "opening" });
    const blocks: Float32Array[] = [];
    const opened = await openMicrophone((block) => {
      blocks.push(block);
    });
    opening.current = false;
    if (!opened.ok) {
      if (mounted.current) setPhase({ kind: "failed", error: opened.error });
      return;
    }
    if (!mounted.current) {
      opened.value.release();
      return;
    }
    const { sampleRate } = opened.value;
    const timer = window.setInterval(() => {
      const samples = joinSamples(blocks);
      if (speechEnded(samples, sampleRate) || samples.length >= maxSeconds * sampleRate) {
        finish(sampleRate);
      }
    }, TICK_MS);
    active.current = { microphone: opened.value, blocks, timer };
    setPhase({ kind: "recording" });
  }, [finish, maxSeconds]);

  const stop = useCallback((): void => {
    const sampleRate = active.current?.microphone.sampleRate ?? null;
    if (sampleRate !== null) finish(sampleRate);
  }, [finish]);

  return { phase, start, stop };
};
