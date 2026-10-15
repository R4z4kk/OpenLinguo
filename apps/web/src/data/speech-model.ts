import { err, ok, type Result } from "@openlinguo/core";
import type { FetchProgress } from "./audio-packs.ts";
import { SpeechModelIndex } from "./format.ts";
import { readJson, sha256, type ImportFailure } from "./import.ts";
import { CACHE_PREFIX, cacheName, INDEX, pieces, url } from "./speech-files.ts";

export type SpeechFailure = ImportFailure | { readonly kind: "cancelled" };

/** `installed`: every file of the current release is stored; `partial`: an interrupted download. */
export type SpeechModelState = "absent" | "partial" | "installed";

export const downloadBytes = (index: SpeechModelIndex): number =>
  index.files.reduce((sum, file) => sum + file.bytes, 0);

const storageFailure = (file: string, error: unknown): SpeechFailure => ({
  kind: "storage",
  file,
  message: String(error),
});

/** The index from the network, or the copy stored with the model when offline. */
export const loadSpeechIndex = async (): Promise<Result<SpeechModelIndex, SpeechFailure>> => {
  let bytes: Uint8Array;
  try {
    const response = await fetch(url(INDEX), { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    const stored = await storedIndex();
    if (stored === null) return err({ kind: "network", file: url(INDEX), message: String(error) });
    bytes = stored;
  }
  return readJson(bytes, SpeechModelIndex, url(INDEX));
};

const storedIndex = async (): Promise<Uint8Array | null> => {
  try {
    const response = await caches.match(url(INDEX));
    return response == null ? null : new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
};

export const speechModelState = async (
  index: SpeechModelIndex,
): Promise<Result<SpeechModelState, SpeechFailure>> => {
  try {
    if (!(await caches.has(cacheName(index)))) return ok("absent");
    const cache = await caches.open(cacheName(index));
    const stored = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
    const wanted = index.files.flatMap(pieces).map(({ path }) => url(path));
    return ok(
      wanted.every((path) => stored.has(path)) && stored.has(url(INDEX)) ? "installed" : "partial",
    );
  } catch (error) {
    return err(storageFailure(cacheName(index), error));
  }
};

/** Deletes every release of the model. */
export const removeSpeechModel = async (): Promise<Result<null, SpeechFailure>> => {
  try {
    const names = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX));
    await Promise.all(names.map((name) => caches.delete(name)));
    return ok(null);
  } catch (error) {
    return err(storageFailure(CACHE_PREFIX, error));
  }
};

/**
 * Downloads the model's files, checks each piece against its sha256 and stores it in the Cache API, so a
 * cancelled or failed download resumes at the next piece. Older releases are removed first.
 */
export const installSpeechModel = async (
  index: SpeechModelIndex,
  fetchPiece: FetchProgress,
  onProgress: (received: number, total: number) => void,
  signal: AbortSignal,
): Promise<Result<null, SpeechFailure>> => {
  const total = downloadBytes(index);
  try {
    const older = (await caches.keys()).filter(
      (name) => name.startsWith(CACHE_PREFIX) && name !== cacheName(index),
    );
    await Promise.all(older.map((name) => caches.delete(name)));
    const cache = await caches.open(cacheName(index));
    const stored = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
    let received = 0;
    for (const piece of index.files.flatMap(pieces)) {
      if (stored.has(url(piece.path))) {
        received += piece.bytes;
        continue;
      }
      onProgress(received, total);
      const bytes = await fetchPiece(piece.path, signal, (count) => {
        onProgress(received + count, total);
      });
      if (signal.aborted) return err({ kind: "cancelled" });
      if (!bytes.ok) return err({ kind: "network", file: url(piece.path), message: bytes.error });
      if ((await sha256(bytes.value)) !== piece.sha256) {
        return err({ kind: "integrity", file: url(piece.path) });
      }
      await cache.put(
        url(piece.path),
        new Response(bytes.value, { headers: { "Content-Length": String(piece.bytes) } }),
      );
      received += piece.bytes;
    }
    onProgress(total, total);
    await cache.put(
      url(INDEX),
      new Response(JSON.stringify(index), { headers: { "Content-Type": "application/json" } }),
    );
    return ok(null);
  } catch (error) {
    return err(storageFailure(cacheName(index), error));
  }
};
