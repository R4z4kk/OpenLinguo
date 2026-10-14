import { readFile } from "node:fs/promises";
import {
  ACCURACY_FLOOR,
  CONFIDENT_ACCURACY_FLOOR,
  CONFIDENT_COVERAGE_FLOOR,
  contour,
  leaveOneSpeakerOut,
  type ToneClass,
  type ToneExample,
} from "@openlinguo/core";
import { expect, test } from "@playwright/test";
import { z } from "zod";

const directory = new URL("../../../data/tone-fixtures/", import.meta.url);

const Index = z.object({
  recordings: z.array(
    z.object({
      file: z.string(),
      speaker: z.string(),
      tone: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    }),
  ),
});

const RATE = 16_000;

/**
 * The fixtures go through the browser's own audio decoder (Chromium and WebKit run this file), then
 * the same pitch contour and classifier as in Node, which owns the accuracy floors.
 */
test("the browser decodes the tone fixtures to what the classifier needs, above the floors", async ({
  page,
  browserName,
}) => {
  test.skip(
    process.platform === "win32" && browserName === "webkit",
    "WebKit for Windows has no Web Audio; CI runs this on Linux",
  );
  const index = Index.parse(JSON.parse(await readFile(new URL("index.json", directory), "utf8")));
  const files = await Promise.all(
    index.recordings.map(async ({ file }) => {
      const bytes = await readFile(new URL(file, directory));
      return { file, base64: bytes.toString("base64"), samples: (bytes.length - 44) / 2 };
    }),
  );

  await page.goto("about:blank");
  const decoded = await page.evaluate(
    async ({ inputs, rate }) => {
      const context = new OfflineAudioContext(1, 1, rate);
      const results: { rate: number; length: number; base64: string }[] = [];
      for (const { base64 } of inputs) {
        const raw = atob(base64);
        const bytes = new Uint8Array(raw.length);
        for (let at = 0; at < raw.length; at++) bytes[at] = raw.charCodeAt(at);
        const buffer = await context.decodeAudioData(bytes.buffer);
        const pcm = new Int16Array(buffer.length);
        const channel = buffer.getChannelData(0);
        for (let at = 0; at < channel.length; at++) {
          pcm[at] = Math.round(Math.max(-1, Math.min(1, channel[at] ?? 0)) * 32767);
        }
        const view = new Uint8Array(pcm.buffer);
        let text = "";
        for (let at = 0; at < view.length; at += 8192) {
          text += String.fromCharCode(...view.subarray(at, at + 8192));
        }
        results.push({ rate: buffer.sampleRate, length: buffer.length, base64: btoa(text) });
      }
      return results;
    },
    { inputs: files.map(({ base64 }) => ({ base64 })), rate: RATE },
  );

  expect(decoded).toHaveLength(files.length);
  const examples: ToneExample[] = [];
  for (const [at, entry] of decoded.entries()) {
    const recording = index.recordings[at] ?? null;
    const source = files[at] ?? null;
    if (recording === null || source === null) throw new Error(`no fixture ${String(at)}`);
    expect(entry.rate, recording.file).toBe(RATE);
    expect(entry.length, recording.file).toBe(source.samples);
    const bytes = Buffer.from(entry.base64, "base64");
    const samples = Float32Array.from(
      { length: bytes.length / 2 },
      (_, at) => bytes.readInt16LE(at * 2) / 32768,
    );
    const result = contour(samples, RATE, 1);
    expect(result.ok, recording.file).toBe(true);
    if (!result.ok) return;
    examples.push({
      speaker: recording.speaker,
      tone: recording.tone satisfies ToneClass,
      contour: result.value,
    });
  }

  const rates = leaveOneSpeakerOut(examples);
  expect(rates.ok).toBe(true);
  if (!rates.ok) return;
  expect(rates.value.accuracy).toBeGreaterThanOrEqual(ACCURACY_FLOOR);
  expect(rates.value.coverage).toBeGreaterThanOrEqual(CONFIDENT_COVERAGE_FLOOR);
  expect(rates.value.confidentAccuracy).toBeGreaterThanOrEqual(CONFIDENT_ACCURACY_FLOOR);
});
