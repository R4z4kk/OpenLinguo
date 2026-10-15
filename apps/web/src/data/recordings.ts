import { ok, type Result } from "@openlinguo/core";
import { wordAudioId } from "./audio-packs.ts";
import type { Database, StoredRecording } from "./database.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

const PCM16_MAX = 0x7fff;

/** Half the size of the browser's 32-bit samples, enough for a voice. */
export const toPcm16 = (samples: Float32Array): Int16Array<ArrayBuffer> =>
  Int16Array.from(samples, (sample) => Math.round(Math.max(-1, Math.min(1, sample)) * PCM16_MAX));

export const fromPcm16 = (data: ArrayBuffer): Float32Array<ArrayBuffer> =>
  Float32Array.from(new Int16Array(data), (sample) => sample / PCM16_MAX);

/** Keeps the learner's recording of a reading, replacing the one kept before. */
export const keepRecording = (
  db: Database,
  recording: Omit<StoredRecording, "id" | "data"> & { readonly samples: Float32Array },
): Promise<Result<null, ReviewLogFailure>> =>
  guarded(async () => {
    const { samples, ...rest } = recording;
    await db.recordings.put({
      ...rest,
      id: wordAudioId(rest.headword, rest.readingKey),
      data: toPcm16(samples).buffer,
    });
    return ok(null);
  });

export const keptRecording = (
  db: Database,
  id: string,
): Promise<Result<StoredRecording | null, ReviewLogFailure>> =>
  guarded(async () => ok((await db.recordings.get(id)) ?? null));

/** Newest first. */
export const keptRecordings = (
  db: Database,
): Promise<Result<readonly StoredRecording[], ReviewLogFailure>> =>
  guarded(async () =>
    ok((await db.recordings.toArray()).sort((a, b) => b.recordedAt - a.recordedAt)),
  );

export const deleteRecording = (
  db: Database,
  id: string,
): Promise<Result<null, ReviewLogFailure>> =>
  guarded(async () => {
    await db.recordings.delete(id);
    return ok(null);
  });

export const deleteRecordings = (db: Database): Promise<Result<null, ReviewLogFailure>> =>
  guarded(async () => {
    await db.recordings.clear();
    return ok(null);
  });
