import { describe, expect, it } from "vitest";
import { decodeWav, encodeWav, trimUtterance } from "./wav.ts";

const SAMPLE_RATE = 24_000;

/** Segments of [seconds, sound]: a 220 Hz tone at half scale, or silence. */
const signal = (
  ...segments: readonly (readonly [seconds: number, sound: boolean])[]
): Float32Array => {
  const parts = segments.map(([seconds, sound]) =>
    Float32Array.from({ length: Math.round(seconds * SAMPLE_RATE) }, (_, index) =>
      sound ? 0.5 * Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE) : 0,
    ),
  );
  const out = new Float32Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const seconds = (samples: Float32Array): number => samples.length / SAMPLE_RATE;

describe("decodeWav", () => {
  it("reads what encodeWav writes", () => {
    const decoded = decodeWav(
      encodeWav({ samples: new Float32Array([0, 0.5, -0.5]), sampleRate: SAMPLE_RATE }),
    );
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

describe("trimUtterance", () => {
  const trim = (samples: Float32Array): number =>
    seconds(trimUtterance({ samples, sampleRate: SAMPLE_RATE }).samples);

  it("trims silence around the sound to 0.1 s", () => {
    expect(trim(signal([0.5, false], [0.3, true], [2.4, false]))).toBeCloseTo(0.5, 1);
  });

  it("drops a sound that comes after a pause longer than 0.7 s", () => {
    expect(trim(signal([0.5, true], [3, false], [0.45, true], [0.2, false]))).toBeCloseTo(0.6, 1);
  });

  it("keeps sounds separated by a short pause", () => {
    expect(trim(signal([0.3, true], [0.3, false], [0.3, true]))).toBeCloseTo(0.9, 1);
  });

  it("leaves audio without any sound unchanged", () => {
    expect(trim(signal([1, false]))).toBe(1);
  });
});
