import { describe, expect, test } from "vitest";
import { joinSamples, speechEnded } from "./recording.ts";

const RATE = 16_000;

const tone = (seconds: number, amplitude: number): Float32Array =>
  Float32Array.from(
    { length: Math.round(seconds * RATE) },
    (_, at) => amplitude * Math.sin((2 * Math.PI * 200 * at) / RATE),
  );

describe("speechEnded", () => {
  test("waits for quiet after the voice", () => {
    expect(speechEnded(joinSamples([tone(0.5, 0.3), tone(0.5, 0.001)]), RATE)).toBe(false);
    expect(speechEnded(joinSamples([tone(0.5, 0.3), tone(0.8, 0.001)]), RATE)).toBe(true);
  });

  test("keeps listening while nothing loud was said", () => {
    expect(speechEnded(tone(2, 0.002), RATE)).toBe(false);
  });

  test("hears a quiet room as quiet once someone spoke", () => {
    expect(speechEnded(joinSamples([tone(0.3, 0.02), tone(0.5, 0.3), tone(0.8, 0.02)]), RATE)).toBe(
      true,
    );
  });
});

describe("joinSamples", () => {
  test("keeps the blocks in order", () => {
    expect([...joinSamples([Float32Array.of(1, 2), Float32Array.of(3)])]).toEqual([1, 2, 3]);
  });
});
