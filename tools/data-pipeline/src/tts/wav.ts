import { err, ok, type Result } from "@openlinguo/core";

export type Pcm = { readonly samples: Float32Array; readonly sampleRate: number };

const tag = (view: DataView, offset: number): string =>
  String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, 4));

/** Mono 16-bit PCM WAV, the format the TTS containers return. */
export const decodeWav = (bytes: Uint8Array): Result<Pcm, string> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || tag(view, 0) !== "RIFF" || tag(view, 8) !== "WAVE") {
    return err("not a RIFF/WAVE file");
  }
  let sampleRate: number | null = null;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const id = tag(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > bytes.byteLength) return err(`truncated ${id} chunk`);
    if (id === "fmt ") {
      const format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const bits = view.getUint16(body + 14, true);
      if (format !== 1 || channels !== 1 || bits !== 16) {
        return err(
          `expected mono 16-bit PCM, got format ${String(format)}, ${String(channels)} channels, ${String(bits)} bits`,
        );
      }
      sampleRate = view.getUint32(body + 4, true);
    }
    if (id === "data") {
      if (sampleRate === null) return err("data chunk before fmt chunk");
      const samples = new Float32Array(Math.floor(size / 2));
      for (let index = 0; index < samples.length; index++) {
        samples[index] = view.getInt16(body + index * 2, true) / 32768;
      }
      return ok({ samples, sampleRate });
    }
    offset = body + size + (size % 2);
  }
  return err("no data chunk");
};
