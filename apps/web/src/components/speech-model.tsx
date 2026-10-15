import { err, type Result } from "@openlinguo/core";
import { useCallback, useEffect, useState } from "react";
import { DownloadControls } from "@/components/download-controls";
import { fetchFrom } from "@/data/audio-packs";
import type { SpeechModelIndex } from "@/data/format";
import { MODELS } from "@/data/speech-files";
import {
  downloadBytes,
  installSpeechModel,
  loadSpeechIndex,
  removeSpeechModel,
  speechModelState,
  type SpeechFailure,
  type SpeechModelState,
} from "@/data/speech-model";
import { speechRecognizer, type RecognizerError } from "@/lib/speech-recognizer";

export type SpeechModel =
  | { readonly status: "loading" }
  | { readonly status: "unavailable"; readonly failure: SpeechFailure }
  | {
      readonly status: "ready";
      readonly index: SpeechModelIndex;
      readonly state: SpeechModelState;
    };

/** The model and whether it is stored; `refresh` after a change. */
export const useSpeechModel = (): { readonly model: SpeechModel; readonly refresh: () => void } => {
  const [model, setModel] = useState<SpeechModel>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const unmounted = new AbortController();
    const load = async (): Promise<SpeechModel> => {
      const index = await loadSpeechIndex();
      if (!index.ok) return { status: "unavailable", failure: index.error };
      const state = await speechModelState(index.value);
      return state.ok
        ? { status: "ready", index: index.value, state: state.value }
        : { status: "unavailable", failure: state.error };
    };
    void load().then((loaded) => {
      if (!unmounted.signal.aborted) setModel(loaded);
    });
    return () => {
      unmounted.abort();
    };
  }, [attempt]);
  const refresh = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);
  return { model, refresh };
};

/** Downloads, cancels or deletes the speech-recognition model, on the learner's request only. */
export const SpeechModelControls = ({
  index,
  state,
  describedBy,
  onChange,
}: {
  readonly index: SpeechModelIndex;
  readonly state: SpeechModelState;
  readonly describedBy: string;
  readonly onChange: () => void;
}) => (
  <DownloadControls
    labels="speech"
    bytes={downloadBytes(index)}
    state={state}
    describedBy={describedBy}
    install={(onProgress, signal) =>
      installSpeechModel(index, fetchFrom(MODELS), onProgress, signal)
    }
    remove={removeSpeechModel}
    onChange={onChange}
  />
);

export type Transcribe = (
  samples: Float32Array,
  sampleRate: number,
) => Promise<Result<string, RecognizerError>>;

/**
 * Transcribes with the stored model. The recognizer starts when a page using it opens, so that it
 * is ready by the end of the first recording, and stays for the next page; it stops once the model
 * is no longer stored.
 */
export const useTranscriber = (model: SpeechModel): Transcribe => {
  const index = model.status === "ready" ? model.index : null;
  const installed = model.status === "ready" && model.state === "installed";
  useEffect(() => {
    if (index === null) return;
    if (installed) speechRecognizer.warm(index);
    else speechRecognizer.close();
  }, [index, installed]);
  return useCallback(
    (samples, sampleRate) =>
      index === null || !installed
        ? Promise.resolve(err({ kind: "missing" }))
        : speechRecognizer.transcribe(index, samples, sampleRate),
    [index, installed],
  );
};
