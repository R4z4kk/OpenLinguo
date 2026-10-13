import { describe, expect, it } from "vitest";
import { filesToLabel, scoreAsr, type Verdicts } from "./asr-report.ts";

const verdicts: Verdicts = new Map([
  ["a.wav", { whisper: true, "firered-asr": true }],
  ["b.wav", { whisper: false, "firered-asr": true }],
  ["c.wav", { whisper: false, "firered-asr": false }],
]);

describe("ASR comparison", () => {
  it("asks a label only where the recognizers disagree", () => {
    expect(filesToLabel(verdicts)).toEqual(["b.wav"]);
  });

  it("counts caught failures, misses and false alarms", () => {
    const labels = { "b.wav": "clean", "c.wav": "wrong" } as const;
    expect(scoreAsr("whisper", verdicts, labels)).toEqual({
      flagged: 2,
      caught: 1,
      missed: 0,
      falseAlarms: 1,
    });
    expect(scoreAsr("firered-asr", verdicts, labels)).toEqual({
      flagged: 1,
      caught: 1,
      missed: 0,
      falseAlarms: 0,
    });
  });
});
