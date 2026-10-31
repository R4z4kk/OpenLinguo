import { describe, expect, it } from "vitest";
import { eitherSignal } from "./abort.ts";

describe("eitherSignal", () => {
  it("aborts when either signal aborts", () => {
    for (const firstAborts of [true, false]) {
      const first = new AbortController();
      const second = new AbortController();
      const { signal } = eitherSignal(first.signal, second.signal);
      expect(signal.aborted).toBe(false);
      (firstAborts ? first : second).abort();
      expect(signal.aborted).toBe(true);
    }
  });

  it("starts aborted when a signal already is", () => {
    expect(eitherSignal(AbortSignal.abort(), new AbortController().signal).signal.aborted).toBe(
      true,
    );
  });

  it("ignores the sources once released", () => {
    const source = new AbortController();
    const { signal, release } = eitherSignal(source.signal, new AbortController().signal);
    release();
    source.abort();
    expect(signal.aborted).toBe(false);
  });
});
