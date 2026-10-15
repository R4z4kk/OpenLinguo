import { err, type Result } from "@openlinguo/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { DownloadControls } from "@/components/download-controls";
import { fetchFrom } from "@/data/audio-packs";
import type { SpeechBackend, SpeechModelIndex } from "@/data/format";
import { MODELS } from "@/data/speech-files";
import {
  chooseBackend,
  downloadBytes,
  installSpeechModel,
  loadSpeechIndex,
  removeSpeechModel,
  speechModelState,
  type SpeechFailure,
  type SpeechModelState,
} from "@/data/speech-model";
import { startRecognizer, type Recognizer, type RecognizerError } from "@/lib/speech-recognizer";

export type SpeechModel =
  | { readonly status: "loading" }
  | { readonly status: "unavailable"; readonly failure: SpeechFailure | null }
  | {
      readonly status: "ready";
      readonly index: SpeechModelIndex;
      readonly backend: SpeechBackend;
      readonly state: SpeechModelState;
    };

/** The model this device would use and whether it is stored; `refresh` after a change. */
export const useSpeechModel = (): { readonly model: SpeechModel; readonly refresh: () => void } => {
  const [model, setModel] = useState<SpeechModel>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const unmounted = new AbortController();
    const load = async (): Promise<SpeechModel> => {
      const index = await loadSpeechIndex();
      if (!index.ok) return { status: "unavailable", failure: index.error };
      const backend = await chooseBackend(index.value);
      if (backend === null) return { status: "unavailable", failure: null };
      const state = await speechModelState(index.value, backend);
      return state.ok
        ? { status: "ready", index: index.value, backend, state: state.value }
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
  backend,
  state,
  describedBy,
  onChange,
}: {
  readonly index: SpeechModelIndex;
  readonly backend: SpeechBackend;
  readonly state: SpeechModelState;
  readonly describedBy: string;
  readonly onChange: () => void;
}) => (
  <DownloadControls
    labels="speech"
    bytes={downloadBytes(index, backend)}
    state={state}
    describedBy={describedBy}
    install={(onProgress, signal) =>
      installSpeechModel(index, backend, fetchFrom(MODELS), onProgress, signal)
    }
    remove={removeSpeechModel}
    onChange={onChange}
  />
);

/** Whisper spends one to two tokens per character; the margin lets an added word through. */
const maxTokens = (characters: number): number => Math.min(200, 2 * characters + 10);

export type Transcribe = (
  samples: Float32Array,
  sampleRate: number,
  expectedCharacters: number,
) => Promise<Result<string, RecognizerError>>;

/** Transcribes with the stored model: the worker starts on first use and stops with the component. */
export const useTranscriber = (model: SpeechModel): Transcribe => {
  const recognizer = useRef<Promise<Result<Recognizer, RecognizerError>> | null>(null);
  useEffect(
    () => () => {
      void recognizer.current?.then((started) => {
        if (started.ok) started.value.close();
      });
      recognizer.current = null;
    },
    [model],
  );
  return useCallback(
    async (samples, sampleRate, expectedCharacters) => {
      if (model.status !== "ready" || model.state !== "installed") return err({ kind: "missing" });
      recognizer.current ??= startRecognizer(model.index, model.backend);
      const started = await recognizer.current;
      if (!started.ok) {
        recognizer.current = null;
        return started;
      }
      const text = await started.value.transcribe(
        samples,
        sampleRate,
        maxTokens(expectedCharacters),
      );
      if (!text.ok) {
        started.value.close();
        recognizer.current = null;
      }
      return text;
    },
    [model],
  );
};
