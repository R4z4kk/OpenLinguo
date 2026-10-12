import { describe, expect, it } from "vitest";
import { decodeWav } from "./wav.ts";

const SAMPLE_RATE = 24_000;

const wav = (samples: Float32Array, sampleRate = SAMPLE_RATE): Uint8Array => {
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
    view.setInt16(44 + index * 2, Math.round(sample * 32767), true);
  });
  return bytes;
};

describe("decodeWav", () => {
  it("reads mono 16-bit PCM", () => {
    const decoded = decodeWav(wav(new Float32Array([0, 0.5, -0.5])));
    expect(decoded.ok && decoded.value.sampleRate).toBe(SAMPLE_RATE);
    expect(decoded.ok && [...decoded.value.samples].map((value) => value.toFixed(2))).toEqual([
      "0.00",
      "0.50",
      "-0.50",
    ]);
  });

  it("refuses other files", () => {
    expect(decodeWav(new TextEncoder().encode("not audio at all")).ok).toBe(false);
  });
});
