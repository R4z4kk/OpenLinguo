import { ok, type Result } from "@openlinguo/core";
import { bandId } from "./audio-packs.ts";
import type { Database } from "./database.ts";
import type { AudioPackBand, AudioPackIndex } from "./format.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

/** The pinyin chart's audio pack band (#105): one recording per syllable and tone. */
export const SYLLABLES_BAND = bandId({ referential: "syllables", level: 1 });

export const syllableBand = ({ bands }: AudioPackIndex): AudioPackBand | null =>
  bands.find((band) => bandId(band) === SYLLABLES_BAND) ?? null;

/** The installed syllable recordings by reading key (`lu:4`): their `wordAudio` ids. */
export const syllableRecordings = (
  db: Database,
): Promise<Result<ReadonlyMap<string, string>, ReviewLogFailure>> =>
  guarded(async () => {
    const ids = await db.wordAudio.where("bands").equals(SYLLABLES_BAND).primaryKeys();
    return ok(new Map(ids.map((id) => [id.slice(id.indexOf("\t") + 1), id])));
  });
