import { err, ok } from "@openlinguo/core";
import { describe, expect, it, vi } from "vitest";
import type { SpeechModelIndex } from "@/data/format";
import { webgpuVerdict, type WebgpuVerdict } from "@/data/speech-model";
import { startTrusted, type Recognizer, type TrustDependencies } from "./speech-recognizer.ts";

const index: SpeechModelIndex = {
  release: "whisper-1",
  model: "whisper-base",
  backends: {},
  files: [],
  check: { path: "whisper-base/self-check.wav", text: "我们一起去吃饭吧" },
};

const memoryStorage = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    getItem: (key) => items.get(key) ?? null,
    key: (position) => [...items.keys()][position] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
};

const setup = (verdict: WebgpuVerdict | "fails") => {
  const recognizer: Recognizer = {
    transcribe: () => Promise.resolve(ok("")),
    close: vi.fn(),
  };
  const store = memoryStorage();
  const dependencies = {
    start: vi.fn(() => Promise.resolve(ok(recognizer))),
    check: vi.fn(() =>
      Promise.resolve(
        verdict === "fails" ? err({ kind: "failed" as const, message: "no audio" }) : ok(verdict),
      ),
    ),
    storage: () => store,
    removeWebgpuFiles: vi.fn(() => Promise.resolve(null)),
  } satisfies TrustDependencies;
  return { recognizer, store, dependencies };
};

describe("startTrusted", () => {
  it("does not check WebAssembly", async () => {
    const { dependencies } = setup("wrong");
    expect((await startTrusted(index, "wasm", dependencies)).ok).toBe(true);
    expect(dependencies.check).not.toHaveBeenCalled();
  });

  it("checks WebGPU once per release, then trusts it", async () => {
    const { dependencies, store } = setup("right");
    expect((await startTrusted(index, "webgpu", dependencies)).ok).toBe(true);
    expect(webgpuVerdict(() => store, index)).toBe("right");
    await startTrusted(index, "webgpu", dependencies);
    expect(dependencies.check).toHaveBeenCalledTimes(1);
    expect(webgpuVerdict(() => store, { ...index, release: "whisper-2" })).toBeNull();
  });

  it("sets WebGPU aside when it gets the sentence wrong, and deletes its files", async () => {
    const { dependencies, store, recognizer } = setup("wrong");
    expect(await startTrusted(index, "webgpu", dependencies)).toEqual(err({ kind: "unreliable" }));
    expect(webgpuVerdict(() => store, index)).toBe("wrong");
    expect(recognizer.close).toHaveBeenCalled();
    expect(dependencies.removeWebgpuFiles).toHaveBeenCalledWith(index);
  });

  it("reports a check that could not run, and decides nothing", async () => {
    const { dependencies, store } = setup("fails");
    expect(await startTrusted(index, "webgpu", dependencies)).toEqual(
      err({ kind: "failed", message: "no audio" }),
    );
    expect(webgpuVerdict(() => store, index)).toBeNull();
    expect(dependencies.removeWebgpuFiles).not.toHaveBeenCalled();
  });
});
