import { describe, expect, it } from "vitest";
import { ATTEMPTS, downloadRelease, type ReleaseIo } from "./release-download.ts";

const ASSET = "https://github.com/R4z4kk/OpenLinguo/releases/download/audio-zh-4/pack.zip";
const BYTES = new Uint8Array([1, 2, 3]);

type Reply = number | Error;

const fake = (replies: readonly Reply[]) => {
  const waits: number[] = [];
  const warnings: string[] = [];
  let calls = 0;
  const io: ReleaseIo = {
    fetch: (url) => {
      expect(url).toBe(ASSET);
      const reply = replies[Math.min(calls, replies.length - 1)];
      if (reply == null) throw new Error("no reply");
      calls += 1;
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve(new Response(reply === 200 ? BYTES : null, { status: reply }));
    },
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    warn: (message) => {
      warnings.push(message);
    },
  };
  return { io, waits, warnings, calls: () => calls };
};

describe("downloadRelease", () => {
  it.each([403, 429, 500, 503])("retries an HTTP %i and returns the bytes", async (status) => {
    const { io, waits, warnings } = fake([status, 200]);
    expect(await downloadRelease(ASSET, io)).toEqual(BYTES);
    expect(waits).toEqual([1000]);
    expect(warnings).toEqual([`${ASSET}: HTTP ${String(status)}, retrying in 1000 ms`]);
  });

  it("retries a network error", async () => {
    const { io, calls } = fake([new TypeError("fetch failed"), 200]);
    expect(await downloadRelease(ASSET, io)).toEqual(BYTES);
    expect(calls()).toBe(2);
  });

  it("fails with the URL and the status after the last attempt", async () => {
    const { io, waits, calls } = fake([403]);
    await expect(downloadRelease(ASSET, io)).rejects.toThrow(
      `${ASSET}: HTTP 403 (${String(ATTEMPTS)} attempt(s))`,
    );
    expect(calls()).toBe(ATTEMPTS);
    expect(waits).toEqual([1000, 2000]);
  });

  it("fails with the network error after the last attempt", async () => {
    const { io } = fake([new TypeError("fetch failed")]);
    await expect(downloadRelease(ASSET, io)).rejects.toThrow(
      `${ASSET}: fetch failed (${String(ATTEMPTS)} attempt(s))`,
    );
  });

  it("does not retry a 404", async () => {
    const { io, waits, calls } = fake([404]);
    await expect(downloadRelease(ASSET, io)).rejects.toThrow(`${ASSET}: HTTP 404 (1 attempt(s))`);
    expect(calls()).toBe(1);
    expect(waits).toEqual([]);
  });
});
