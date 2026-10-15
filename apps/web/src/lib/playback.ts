import { err, ok, type Result } from "@openlinguo/core";

/** Silence between two clips. */
const GAP_SECONDS = 0.4;

export type Clip =
  | { readonly kind: "encoded"; readonly data: ArrayBuffer }
  | { readonly kind: "samples"; readonly samples: Float32Array; readonly sampleRate: number };

const bufferOf = (context: AudioContext, clip: Clip): Promise<AudioBuffer> => {
  if (clip.kind === "encoded") return context.decodeAudioData(clip.data.slice(0));
  const buffer = context.createBuffer(1, Math.max(1, clip.samples.length), clip.sampleRate);
  buffer.copyToChannel(new Float32Array(clip.samples), 0);
  return Promise.resolve(buffer);
};

/**
 * Plays clips one after the other, only when asked: call it from the user's action, the audio context
 * is created before `load` so that Safari lets it run. Resolves once played or when `signal` aborts.
 */
export const playInTurn = async (
  load: () => Promise<Result<readonly Clip[], string>>,
  signal: AbortSignal,
): Promise<Result<null, string>> => {
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch (error) {
    return err(String(error));
  }
  try {
    const clips = await load();
    if (!clips.ok) return clips;
    const buffers = await Promise.all(clips.value.map((clip) => bufferOf(context, clip)));
    await context.resume();
    if (signal.aborted) return ok(null);
    let at = context.currentTime;
    const ended = buffers.map((buffer) => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(at);
      at += buffer.duration + GAP_SECONDS;
      return new Promise<void>((resolve) => {
        source.onended = () => {
          resolve();
        };
      });
    });
    await Promise.race([
      Promise.all(ended),
      new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true },
        );
      }),
    ]);
    return ok(null);
  } catch (error) {
    return err(String(error));
  } finally {
    if (context.state !== "closed") void context.close();
  }
};
