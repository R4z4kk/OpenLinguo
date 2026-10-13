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

export const encodeWav = ({ samples, sampleRate }: Pcm): Uint8Array => {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index++)
      bytes[offset + index] = value.charCodeAt(index);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
  });
  return bytes;
};

const FRAME_SECONDS = 0.02;
const SILENCE_DB = -50;
const MAX_GAP_SECONDS = 0.7;
const PAD_SECONDS = 0.1;

/**
 * Keeps the first utterance: audio after a pause longer than 0.7 s is dropped (a word or a comma-free sentence
 * is over by then; TTS models sometimes add a sound after a long silence), and silence around it is trimmed to
 * 0.1 s so consonants keep their edges. Audio without any sound is returned unchanged.
 */
export const trimUtterance = ({ samples, sampleRate }: Pcm): Pcm => {
  const frame = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const voiced: boolean[] = [];
  for (let start = 0; start < samples.length; start += frame) {
    const end = Math.min(samples.length, start + frame);
    let energy = 0;
    for (let index = start; index < end; index++) energy += (samples[index] ?? 0) ** 2;
    voiced.push(10 * Math.log10(energy / (end - start) + 1e-12) > SILENCE_DB);
  }
  const first = voiced.indexOf(true);
  if (first === -1) return { samples, sampleRate };
  const maxGap = Math.round(MAX_GAP_SECONDS / FRAME_SECONDS);
  let last = first;
  for (let index = first, gap = 0; index < voiced.length && gap < maxGap; index++) {
    if (voiced[index] === true) {
      last = index;
      gap = 0;
    } else {
      gap += 1;
    }
  }
  const pad = Math.round(PAD_SECONDS * sampleRate);
  const from = Math.max(0, first * frame - pad);
  const to = Math.min(samples.length, (last + 1) * frame + pad);
  return { samples: samples.slice(from, to), sampleRate };
};
