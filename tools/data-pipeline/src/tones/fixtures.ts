import { readFile } from "node:fs/promises";
import { contour, type Contour } from "@openlinguo/core";
import { z } from "zod";
import { dataDir } from "../manifest.ts";
import { decodeWav } from "../tts/wav.ts";

export const fixturesDir = new URL("tone-fixtures/", dataDir);
export const indexPath = new URL("index.json", fixturesDir);

const Tone = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

/** `data/tone-fixtures/index.json`: human recordings of one syllable each, tone known from CC-CEDICT. */
export const indexSchema = z.strictObject({
  license: z.literal("CC0-1.0"),
  source: z.string().min(1),
  retrievedAt: z.iso.date(),
  /** How the files were made from the Commons originals (tools/data-pipeline/src/tones/tones.ts). */
  processing: z.string().min(1),
  recordings: z.array(
    z.strictObject({
      file: z.string().regex(/^[0-9a-f]{12}\.wav$/u),
      speaker: z.string().min(1),
      gender: z.enum(["female", "male"]),
      word: z.string().min(1),
      tone: Tone,
      commons: z.url(),
      /** License templates of the Commons file page; a CC0 option is required. */
      offered: z.string().min(1),
    }),
  ),
});
export type FixtureIndex = z.output<typeof indexSchema>;

export type Fixture = FixtureIndex["recordings"][number] & {
  readonly samples: Float32Array;
  readonly sampleRate: number;
  readonly contour: Contour;
};

export class FixtureError extends Error {}

/** The recordings with their pitch contours, decoded the way the pipeline does. */
export const loadFixtures = async (): Promise<readonly Fixture[]> => {
  const parsed = indexSchema.safeParse(JSON.parse(await readFile(indexPath, "utf8")) as unknown);
  if (!parsed.success)
    throw new FixtureError(`invalid ${indexPath.pathname}: ${parsed.error.message}`);
  const loaded: Fixture[] = [];
  for (const recording of parsed.data.recordings) {
    const wav = decodeWav(new Uint8Array(await readFile(new URL(recording.file, fixturesDir))));
    if (!wav.ok) throw new FixtureError(`${recording.file}: ${wav.error}`);
    const result = contour(wav.value.samples, wav.value.sampleRate, 1);
    if (!result.ok) throw new FixtureError(`${recording.file}: ${result.error}`);
    loaded.push({ ...recording, ...wav.value, contour: result.value });
  }
  return loaded;
};
