import { err, ok, type Result } from "@openlinguo/core";
import { openZip } from "@/lib/zip";
import type { Database, StoredWordAudio } from "./database.ts";
import { AudioPackContent, AudioPackIndex, type AudioPackBand } from "./format.ts";
import { readJson, sha256, type FetchFile, type ImportFailure } from "./import.ts";

export type AudioFailure = ImportFailure | { readonly kind: "cancelled" };

/** Stored audio to play: a deck's own (`audio`, from an Anki import) or an audio pack's recording (`wordAudio`). */
export type AudioSource = { readonly table: "audio" | "wordAudio"; readonly id: string };

/** Downloads `/data/<name>`, reporting the bytes received so far. */
export type FetchProgress = (
  name: string,
  signal: AbortSignal,
  onBytes: (received: number) => void,
) => Promise<Result<Uint8Array<ArrayBuffer>, string>>;

export const fetchWithProgress: FetchProgress = async (name, signal, onBytes) => {
  try {
    const response = await fetch(`/data/${name}`, { cache: "no-store", signal });
    if (!response.ok || response.body === null) return err(`HTTP ${String(response.status)}`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      chunks.push(chunk.value);
      received += chunk.value.length;
      onBytes(received);
    }
    const bytes = new Uint8Array(received);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    return ok(bytes);
  } catch (error) {
    return err(String(error));
  }
};

const INDEX = "audio-zh/index.json";

export const bandId = ({
  referential,
  level,
}: Pick<AudioPackBand, "referential" | "level">): string => `${referential}:${String(level)}`;

export const wordAudioId = (headword: string, readingKey: string): string =>
  `${headword}\t${readingKey}`;

export const bandBytes = (band: AudioPackBand): number =>
  band.parts.reduce((total, part) => total + part.bytes, 0);

export const loadAudioIndex = async (
  fetchFile: FetchFile,
): Promise<Result<AudioPackIndex, AudioFailure>> => {
  const bytes = await fetchFile(INDEX);
  if (!bytes.ok) return err({ kind: "network", file: INDEX, message: bytes.error });
  return readJson(bytes.value, AudioPackIndex, INDEX);
};

/** `installed`: every part of the current release is stored; `partial`: an interrupted or older download. */
export type BandState = "absent" | "partial" | "installed";

export const bandStates = async (
  db: Database,
  { release, bands }: AudioPackIndex,
): Promise<Result<ReadonlyMap<string, BandState>, AudioFailure>> => {
  try {
    const stored = new Map((await db.audioBands.toArray()).map((band) => [band.id, band]));
    return ok(
      new Map(
        bands.map((band): [string, BandState] => {
          const saved = stored.get(bandId(band)) ?? null;
          if (saved === null) return [bandId(band), "absent"];
          const complete =
            saved.release === release &&
            band.parts.every((part) => saved.parts.includes(part.sha256));
          return [bandId(band), complete ? "installed" : "partial"];
        }),
      ),
    );
  } catch (error) {
    return err({ kind: "storage", file: INDEX, message: String(error) });
  }
};

export type AudioPacks = {
  readonly index: AudioPackIndex;
  readonly states: ReadonlyMap<string, BandState>;
};

export const loadAudioPacks = async (
  db: Database,
  fetchFile: FetchFile,
): Promise<Result<AudioPacks, AudioFailure>> => {
  const index = await loadAudioIndex(fetchFile);
  if (!index.ok) return index;
  const states = await bandStates(db, index.value);
  return states.ok ? ok({ index: index.value, states: states.value }) : states;
};

type Recording = Omit<StoredWordAudio, "bands">;

const formatFailure = (file: string, message: string): AudioFailure => ({
  kind: "format",
  file,
  message,
});

/** The recordings of a pack part, read entry by entry from the zip (apps/web/src/lib/zip.ts). */
const readPart = async (
  bytes: Uint8Array<ArrayBuffer>,
  file: string,
): Promise<Result<Recording[], AudioFailure>> => {
  const archive = await openZip(new Blob([bytes]));
  if (!archive.ok) return err(formatFailure(file, archive.error.kind));
  const read = async (name: string): Promise<Result<Uint8Array, AudioFailure>> => {
    const entry = archive.value.entries.get(name) ?? null;
    if (entry === null) return err(formatFailure(file, `${name} is missing`));
    const content = await archive.value.read(entry);
    return content.ok ? content : err(formatFailure(file, `${name}: ${content.error.kind}`));
  };
  const indexBytes = await read("index.json");
  if (!indexBytes.ok) return indexBytes;
  const content = readJson(indexBytes.value, AudioPackContent, `${file}/index.json`);
  if (!content.ok) return content;
  const recordings: Recording[] = [];
  for (const { file: name, word, reading } of content.value.files) {
    const audio = await read(name);
    if (!audio.ok) return audio;
    recordings.push({
      id: wordAudioId(word, reading),
      type: "audio/mpeg",
      data: new Uint8Array(audio.value).buffer,
    });
  }
  return ok(recordings);
};

/** Removes a band; a recording another installed band holds stays. */
export const removeBand = async (db: Database, id: string): Promise<Result<null, AudioFailure>> => {
  try {
    await db.transaction("rw", [db.wordAudio, db.audioBands], async () => {
      const rows = await db.wordAudio.where("bands").equals(id).toArray();
      const kept = rows.map((row) => ({ ...row, bands: row.bands.filter((band) => band !== id) }));
      await db.wordAudio.bulkDelete(
        kept.filter((row) => row.bands.length === 0).map((row) => row.id),
      );
      await db.wordAudio.bulkPut(kept.filter((row) => row.bands.length > 0));
      await db.audioBands.delete(id);
    });
    return ok(null);
  } catch (error) {
    return err({ kind: "storage", file: id, message: String(error) });
  }
};

/**
 * Downloads a band's parts, checks each against its sha256 and stores it in one transaction, so a
 * cancelled or failed download resumes at the next part. An older release's band is removed first.
 */
export const installBand = async (
  db: Database,
  release: string,
  band: AudioPackBand,
  fetchPart: FetchProgress,
  onProgress: (received: number, total: number) => void,
  signal: AbortSignal,
): Promise<Result<null, AudioFailure>> => {
  const id = bandId(band);
  const total = bandBytes(band);
  try {
    const saved = (await db.audioBands.get(id)) ?? null;
    if (saved !== null && saved.release !== release) {
      const removed = await removeBand(db, id);
      if (!removed.ok) return removed;
    }
    const done = new Set(saved !== null && saved.release === release ? saved.parts : []);
    let received = band.parts
      .filter((part) => done.has(part.sha256))
      .reduce((sum, part) => sum + part.bytes, 0);
    onProgress(received, total);
    for (const part of band.parts) {
      if (done.has(part.sha256)) continue;
      const file = `audio-zh/${part.file}`;
      const bytes = await fetchPart(file, signal, (count) => {
        onProgress(received + count, total);
      });
      if (signal.aborted) return err({ kind: "cancelled" });
      if (!bytes.ok) return err({ kind: "network", file, message: bytes.error });
      if ((await sha256(bytes.value)) !== part.sha256) return err({ kind: "integrity", file });
      const recordings = await readPart(bytes.value, file);
      if (!recordings.ok) return recordings;
      done.add(part.sha256);
      await db.transaction("rw", [db.wordAudio, db.audioBands], async () => {
        const existing = await db.wordAudio.bulkGet(
          recordings.value.map((recording) => recording.id),
        );
        await db.wordAudio.bulkPut(
          recordings.value.map((recording, index) => ({
            ...recording,
            bands: [...new Set([...(existing[index]?.bands ?? []), id])],
          })),
        );
        await db.audioBands.put({ id, release, parts: [...done] });
      });
      received += part.bytes;
      onProgress(received, total);
    }
    return ok(null);
  } catch (error) {
    return err({ kind: "storage", file: id, message: String(error) });
  }
};
