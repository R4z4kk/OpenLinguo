import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { trainToneModel } from "@openlinguo/core";
import { z } from "zod";
import { decodeWav, encodeWav, trimUtterance } from "../tts/wav.ts";
import { fixturesDir, indexPath, loadFixtures, type FixtureIndex } from "./fixtures.ts";

const modelPath = new URL("../../../../packages/core/src/tone-model.ts", import.meta.url);

const TARGET_RATE = 16_000;

/** One entry per original recording: its id (file name), Commons title, speaker, word and tone. */
const sourceSchema = z.array(
  z.object({
    id: z.string().regex(/^[0-9a-f]{12}$/u),
    title: z.string().min(1),
    speaker: z.string().min(1),
    gender: z.enum(["female", "male"]),
    word: z.string().min(1),
    tone: z.number().int().min(1).max(4),
    license: z.string().min(1),
  }),
);

/** Mean of each group of `factor` samples: nothing above 8 kHz is worth keeping in a voice. */
const decimate = (samples: Float32Array, factor: number): Float32Array => {
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let at = 0; at < out.length; at++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += samples[at * factor + k] ?? 0;
    out[at] = sum / factor;
  }
  return out;
};

const isTone = (value: number): value is 1 | 2 | 3 | 4 => value >= 1 && value <= 4;

const buildFixtures = async (manifestPath: string, audioDir: string): Promise<void> => {
  const parsed = sourceSchema.safeParse(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
  );
  if (!parsed.success) throw new Error(`invalid ${manifestPath}: ${parsed.error.message}`);
  await mkdir(fixturesDir, { recursive: true });
  const recordings: FixtureIndex["recordings"] = [];
  for (const item of parsed.data) {
    if (!isTone(item.tone)) throw new Error(`${item.id}: tone ${String(item.tone)}`);
    const wav = decodeWav(new Uint8Array(await readFile(`${audioDir}/${item.id}.wav`)));
    if (!wav.ok) throw new Error(`${item.id}: ${wav.error}`);
    if (wav.value.sampleRate % TARGET_RATE !== 0) {
      throw new Error(`${item.id}: ${String(wav.value.sampleRate)} Hz is not a multiple of 16 kHz`);
    }
    if (!/(^|\+)(cc-0|cc-zero)(\+|$)/u.test(item.license)) {
      throw new Error(`${item.id}: no CC0 option in ${item.license}`);
    }
    const trimmed = trimUtterance(wav.value);
    const samples = decimate(trimmed.samples, trimmed.sampleRate / TARGET_RATE);
    await writeFile(
      new URL(`${item.id}.wav`, fixturesDir),
      encodeWav({ samples, sampleRate: TARGET_RATE }),
    );
    recordings.push({
      file: `${item.id}.wav`,
      speaker: item.speaker,
      gender: item.gender,
      word: item.word,
      tone: item.tone,
      commons: `https://commons.wikimedia.org/wiki/${encodeURI(item.title.replaceAll(" ", "_"))}`,
      offered: item.license,
    });
  }
  const index: FixtureIndex = {
    license: "CC0-1.0",
    source:
      "Lingua Libre recordings of Mandarin on Wikimedia Commons, Category:Lingua_Libre_pronunciation-cmn",
    retrievedAt: new Date().toISOString().slice(0, 10),
    processing:
      "original WAV 48 kHz mono; silence trimmed to 0.1 s around the first utterance; mean of 3 samples to 16 kHz",
    recordings: recordings.sort((a, b) => (a.file < b.file ? -1 : 1)),
  };
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`${String(recordings.length)} recordings in ${fixturesDir.pathname}`);
};

const writeModel = async (): Promise<void> => {
  const fixtures = await loadFixtures();
  const model = trainToneModel(fixtures);
  if (!model.ok) throw new Error(`cannot train: ${JSON.stringify(model.error)}`);
  const source = `import type { ToneModel } from "./tone-classifier.ts";

/**
 * Trained by \`pnpm --filter @openlinguo/data-pipeline tone-model\` on data/tone-fixtures (ADR 0007);
 * a test fails when the fixtures change and this file does not.
 */
export const TONE_MODEL: ToneModel = ${JSON.stringify(model.value)};
`;
  await writeFile(modelPath, source);
  console.log(`model of ${String(fixtures.length)} recordings in ${fileURLToPath(modelPath)}`);
};

const main = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    options: { manifest: { type: "string" }, audio: { type: "string" } },
    allowPositionals: true,
  });
  switch (positionals[0]) {
    case "fixtures":
      if (typeof values.manifest !== "string" || typeof values.audio !== "string") {
        throw new Error("usage: tones fixtures --manifest <manifest.json> --audio <dir>");
      }
      await buildFixtures(values.manifest, values.audio);
      return;
    case "model":
      await writeModel();
      return;
    default:
      throw new Error("usage: tones fixtures --manifest <file> --audio <dir> | tones model");
  }
};

main().catch((error: unknown) => {
  console.error(String(error));
  process.exitCode = 1;
});
