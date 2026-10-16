import { z } from "zod";
import { dataDir } from "../manifest.ts";
import { REFERENTIALS, SYLLABLES } from "./pack-words.ts";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);

/** `data/audio-zh/packs.json`: what each band's pack holds and what built it; pinned in data/manifest.json. */
export const packIndexSchema = z.strictObject({
  release: z.string().min(1),
  license: z.literal("CC0-1.0"),
  generator: z.strictObject({
    tts: z.string().min(1),
    voiceSha256: sha256,
    asr: z.string().min(1),
    encoder: z.string().min(1),
    /** Pitch contours in each part's index.json (core F0_VERSION); an index built before them holds null. */
    f0: z.string().min(1).nullable().default(null),
    /** The vocoder of the pinyin chart's tone transfers (#105); null before them. */
    vocoder: z.string().min(1).nullable().default(null),
  }),
  /** sha256 in data/manifest.json of each word list when the packs were built. */
  words: z.record(z.enum(Object.values(REFERENTIALS)), sha256),
  bands: z.array(
    z.strictObject({
      referential: z.enum([
        ...(Object.keys(REFERENTIALS) as (keyof typeof REFERENTIALS)[]),
        SYLLABLES,
      ]),
      level: z.number().int().min(1).max(7),
      entries: z.number().int().nonnegative(),
      validatedByEar: z.number().int().nonnegative(),
      parts: z.array(
        z.strictObject({ file: z.string().min(1), bytes: z.number().int().positive(), sha256 }),
      ),
    }),
  ),
});
export type PackIndex = z.infer<typeof packIndexSchema>;

export const AUDIO_DATASET = "audio-zh";
export const packIndexPath = new URL("audio-zh/packs.json", dataDir);
