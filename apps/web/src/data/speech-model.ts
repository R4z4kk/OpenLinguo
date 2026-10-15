import { err, ok, type Result } from "@openlinguo/core";
import { readStored, writeStored } from "@/lib/stored";
import type { FetchProgress } from "./audio-packs.ts";
import { SpeechModelIndex, type SpeechBackend, type SpeechModelFile } from "./format.ts";
import { readJson, sha256, type ImportFailure } from "./import.ts";
import { CACHE_PREFIX, cacheName, INDEX, pieces, url } from "./speech-files.ts";

export type SpeechFailure = ImportFailure | { readonly kind: "cancelled" };

/** `installed`: every file of the current release is stored; `partial`: an interrupted download. */
export type SpeechModelState = "absent" | "partial" | "installed";

export const backendFiles = (
  index: SpeechModelIndex,
  backend: SpeechBackend,
): readonly SpeechModelFile[] =>
  index.files.filter((file) => (file.backends ?? [backend]).includes(backend));

export const downloadBytes = (index: SpeechModelIndex, backend: SpeechBackend): number =>
  backendFiles(index, backend).reduce((sum, file) => sum + file.bytes, 0);

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

const VERDICT_KEY = "openlinguo.speechWebgpu";

/** Whether WebGPU transcribed the self-check sentence right on this device: `null` until tried. */
export type WebgpuVerdict = "right" | "wrong";

export const webgpuVerdict = (
  storage: () => Storage,
  index: SpeechModelIndex,
): WebgpuVerdict | null => {
  const stored = readStored(storage, VERDICT_KEY);
  if (!stored.ok || stored.value === null) return null;
  const [release, verdict] = stored.value.split(" ");
  return release === index.release && (verdict === "right" || verdict === "wrong") ? verdict : null;
};

export const recordWebgpuVerdict = (
  storage: () => Storage,
  index: SpeechModelIndex,
  verdict: WebgpuVerdict,
): Result<null, string> => writeStored(storage, VERDICT_KEY, `${index.release} ${verdict}`);

/**
 * WebGPU when the device has it, with 16-bit floats if the model uses them, unless it already got
 * the self-check sentence wrong; else WebAssembly.
 */
export const chooseBackend = async (
  index: SpeechModelIndex,
  storage: () => Storage,
): Promise<SpeechBackend | null> => {
  const webgpu = index.backends.webgpu ?? null;
  if (webgpu !== null && "gpu" in navigator && webgpuVerdict(storage, index) !== "wrong") {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      const needsF16 = Object.values(webgpu.dtype).includes("fp16");
      if (adapter !== null && (!needsF16 || adapter.features.has("shader-f16"))) return "webgpu";
    } catch {
      // No usable adapter: WebAssembly below.
    }
  }
  return index.backends.wasm == null ? null : "wasm";
};

export const speechModelState = async (
  index: SpeechModelIndex,
  backend: SpeechBackend,
): Promise<Result<SpeechModelState, SpeechFailure>> => {
  try {
    if (!(await caches.has(cacheName(index)))) return ok("absent");
    const cache = await caches.open(cacheName(index));
    const stored = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
    const wanted = backendFiles(index, backend).flatMap((file) =>
      pieces(file).map(({ path }) => url(path)),
    );
    return ok(
      wanted.every((path) => stored.has(path)) && stored.has(url(INDEX)) ? "installed" : "partial",
    );
  } catch (error) {
    return err(storageFailure(cacheName(index), error));
  }
};

/** Deletes the files only `backend` loads, once the device is known to need the other one. */
export const removeBackendFiles = async (
  index: SpeechModelIndex,
  backend: SpeechBackend,
): Promise<Result<null, SpeechFailure>> => {
  try {
    const cache = await caches.open(cacheName(index));
    const only = index.files.filter(
      ({ backends }) => backends?.length === 1 && backends[0] === backend,
    );
    await Promise.all(only.flatMap(pieces).map(({ path }) => cache.delete(url(path))));
    return ok(null);
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
 * Downloads the backend's files, checks each piece against its sha256 and stores it in the Cache API, so a
 * cancelled or failed download resumes at the next piece. Older releases are removed first.
 */
export const installSpeechModel = async (
  index: SpeechModelIndex,
  backend: SpeechBackend,
  fetchPiece: FetchProgress,
  onProgress: (received: number, total: number) => void,
  signal: AbortSignal,
): Promise<Result<null, SpeechFailure>> => {
  const total = downloadBytes(index, backend);
  try {
    const older = (await caches.keys()).filter(
      (name) => name.startsWith(CACHE_PREFIX) && name !== cacheName(index),
    );
    await Promise.all(older.map((name) => caches.delete(name)));
    const cache = await caches.open(cacheName(index));
    const stored = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
    let received = 0;
    for (const piece of backendFiles(index, backend).flatMap(pieces)) {
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
