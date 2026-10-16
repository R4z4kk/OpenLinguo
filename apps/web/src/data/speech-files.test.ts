import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpeechModelIndex } from "./format.ts";
import { storedFile } from "./speech-files.ts";

/** Cache Storage as the spec has it: `open` creates the cache, `match` with a cacheName does not. */
const fakeCaches = () => {
  const stores = new Map<string, Map<string, Response>>();
  const open = (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    return Promise.resolve({
      match: (path: string) => Promise.resolve(store.get(path)?.clone()),
      put: (path: string, response: Response) => {
        store.set(path, response);
        return Promise.resolve();
      },
    });
  };
  const match = (path: string, { cacheName }: { readonly cacheName: string }) =>
    Promise.resolve(stores.get(cacheName)?.get(path)?.clone());
  const caches = {
    open,
    match,
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
  };
  vi.stubGlobal("caches", caches);
  return caches;
};

const file = { path: "m/tokens.txt", bytes: 3, sha256: "0".repeat(64) };
const index: SpeechModelIndex = {
  release: "paraformer-1",
  model: file.path,
  tokens: file.path,
  runtime: file.path,
  files: [file],
};

describe("storedFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a stored file", async () => {
    const caches = fakeCaches();
    await (
      await caches.open("speech-model-paraformer-1")
    ).put("/models/m/tokens.txt", new Response("abc"));
    expect(await (await storedFile(index, file))?.text()).toBe("abc");
  });

  it("leaves no cache behind when the model was deleted while the worker loads it", async () => {
    const caches = fakeCaches();
    expect(await storedFile(index, file)).toBeNull();
    expect(await caches.keys()).toEqual([]);
  });
});
