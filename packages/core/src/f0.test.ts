import { describe, expect, it } from "vitest";
import { contour, POINTS_PER_SYLLABLE, unfoldOctaves } from "./f0.ts";

const RATE = 24_000;

/** A voiced sound whose pitch follows `hz(t)`, with two harmonics like a voice. */
const voice = (hz: (t: number) => number, seconds: number, rate = RATE, gain = 1): Float32Array => {
  const out = new Float32Array(Math.round(seconds * rate));
  let phase = 0;
  for (let index = 0; index < out.length; index++) {
    phase += (2 * Math.PI * hz(index / rate)) / rate;
    out[index] =
      gain * (0.5 * Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase));
  }
  return out;
};

const silence = (seconds: number, rate = RATE): Float32Array =>
  new Float32Array(Math.round(seconds * rate));

const join = (...parts: Float32Array[]): Float32Array => {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const values = (points: readonly (number | null)[]): number[] =>
  points.filter((point): point is number => point !== null);

const rising = (from: number, to: number, seconds: number) => (t: number) =>
  from + ((to - from) * t) / seconds;

describe("contour", () => {
  it("follows a rising sweep up", () => {
    const result = contour(voice(rising(150, 250, 0.4), 0.4), RATE, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const points = values(result.value);
    expect(result.value).toHaveLength(POINTS_PER_SYLLABLE);
    expect(points.length).toBeGreaterThanOrEqual(8);
    expect((points.at(-1) ?? 0) - (points.at(0) ?? 0)).toBeGreaterThan(60);
    points.slice(1).forEach((point, index) => {
      expect(point).toBeGreaterThanOrEqual((points[index] ?? 0) - 5);
    });
  });

  it("follows a falling sweep down", () => {
    const result = contour(voice(rising(250, 150, 0.4), 0.4), RATE, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const points = values(result.value);
    expect((points.at(0) ?? 0) - (points.at(-1) ?? 0)).toBeGreaterThan(60);
    points.slice(1).forEach((point, index) => {
      expect(point).toBeLessThanOrEqual((points[index] ?? 0) + 5);
    });
  });

  it("keeps a flat pitch flat", () => {
    const result = contour(
      voice(() => 200, 0.4),
      RATE,
      1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    values(result.value).forEach((point) => {
      expect(Math.abs(point)).toBeLessThanOrEqual(8);
    });
  });

  it("gives no contour for silence or noise-free zeros", () => {
    expect(contour(silence(0.5), RATE, 1)).toEqual({ ok: false, error: "no-voice" });
    expect(contour(new Float32Array(10), RATE, 1)).toEqual({ ok: false, error: "no-voice" });
  });

  it("cuts two syllables and leaves the pause unvoiced", () => {
    const word = join(
      voice(rising(150, 250, 0.3), 0.3),
      silence(0.2),
      voice(rising(250, 150, 0.3), 0.3),
    );
    const result = contour(word, RATE, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2 * POINTS_PER_SYLLABLE);
    const first = values(result.value.slice(0, POINTS_PER_SYLLABLE));
    const second = values(result.value.slice(POINTS_PER_SYLLABLE));
    expect((first.at(-1) ?? 0) - (first.at(0) ?? 0)).toBeGreaterThan(40);
    expect((second.at(0) ?? 0) - (second.at(-1) ?? 0)).toBeGreaterThan(40);
    expect(result.value).toContain(null);
  });

  it("does not depend on the loudness or the sample rate", () => {
    const word = rising(150, 250, 0.4);
    const reference = contour(voice(word, 0.4), RATE, 1);
    const quiet = contour(voice(word, 0.4, RATE, 0.05), RATE, 1);
    const wide = contour(voice(word, 0.4, 48_000), 48_000, 1);
    for (const other of [quiet, wide]) {
      expect(reference.ok && other.ok).toBe(true);
      if (!reference.ok || !other.ok) return;
      other.value.forEach((point, index) => {
        const expected = reference.value[index] ?? null;
        if (point !== null && expected !== null)
          expect(Math.abs(point - expected)).toBeLessThan(15);
      });
    }
  });

  it("refuses an input it cannot analyse", () => {
    expect(
      contour(
        voice(() => 200, 0.4),
        RATE,
        0,
      ),
    ).toEqual({ ok: false, error: "invalid-input" });
    expect(
      contour(
        voice(() => 200, 0.4),
        RATE,
        1.5,
      ),
    ).toEqual({ ok: false, error: "invalid-input" });
    expect(
      contour(
        voice(() => 200, 0.4),
        0,
        1,
      ),
    ).toEqual({ ok: false, error: "invalid-input" });
  });
});

describe("unfoldOctaves", () => {
  it("brings octave jumps back next to the neighbors", () => {
    expect(unfoldOctaves([200, 202, 404, 198, 101, 100])).toEqual([200, 202, 202, 198, 202, 200]);
  });

  it("keeps a real jump of a few semitones", () => {
    expect(unfoldOctaves([200, 200, 300])).toEqual([200, 200, 300]);
  });

  it("halves a recording read an octave too high throughout", () => {
    expect(unfoldOctaves([520, 520, 540])).toEqual([260, 260, 270]);
  });

  it("drops what no octave brings into the speech range", () => {
    expect(unfoldOctaves([200, null, 30, 200])).toEqual([200, null, null, 200]);
  });
});
