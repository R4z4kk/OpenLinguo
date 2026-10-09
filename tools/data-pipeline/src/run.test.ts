import { err, ok } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import type { Manifest } from "./manifest.ts";
import { runDataset, sha256, type Dataset, type FetchBytes, type ShardReader } from "./run.ts";

const bytes = new TextEncoder().encode("release 1");
const now = new Date("2026-10-09T12:00:00Z");

const dataset: Dataset = {
  id: "sample",
  url: "https://example.org/sample.txt",
  license: "CC-BY-SA-4.0",
  maxAgeDays: 90,
  build: () =>
    ok({ version: "v1", files: new Map([["entries-000.json", "[]\n"]]), summary: "0 entries" }),
};

const serve: FetchBytes = () => Promise.resolve(ok(bytes));
const readShards: ShardReader = () => Promise.resolve(ok([]));

const pinned = (sha: string): Manifest => ({
  sample: {
    source: dataset.url,
    license: dataset.license,
    version: "v0",
    retrievedAt: "2026-09-01T00:00:00.000Z",
    maxAgeDays: 90,
    sha256: sha,
  },
});

describe("runDataset", () => {
  it("refuses an unpinned dataset without --refresh", async () => {
    const result = await runDataset(
      dataset,
      {},
      { refresh: false, now, fetchBytes: serve, readShards },
    );
    expect(result).toEqual(err({ kind: "not-pinned", dataset: "sample" }));
  });

  it("fails loudly on checksum mismatch", async () => {
    const result = await runDataset(dataset, pinned("0".repeat(64)), {
      refresh: false,
      now,
      fetchBytes: serve,
      readShards,
    });
    expect(result.ok || result.error.kind).toBe("checksum-mismatch");
  });

  it("rebuilds a pinned dataset and keeps its retrieval date", async () => {
    const result = await runDataset(dataset, pinned(sha256(bytes)), {
      refresh: false,
      now,
      fetchBytes: serve,
      readShards,
    });
    expect(result.ok && result.value.entry.retrievedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("pins the new checksum and date on --refresh", async () => {
    const result = await runDataset(dataset, pinned("0".repeat(64)), {
      refresh: true,
      now,
      fetchBytes: serve,
      readShards,
    });
    expect(result.ok && result.value.entry).toEqual({
      source: dataset.url,
      license: "CC-BY-SA-4.0",
      version: "v1",
      retrievedAt: "2026-10-09T12:00:00.000Z",
      maxAgeDays: 90,
      sha256: sha256(bytes),
    });
  });

  it("propagates download and build failures", async () => {
    const down: FetchBytes = (url) =>
      Promise.resolve(err({ kind: "download-failed", url, message: "HTTP 503" }));
    expect(
      (await runDataset(dataset, {}, { refresh: true, now, fetchBytes: down, readShards })).ok,
    ).toBe(false);
    const broken: Dataset = { ...dataset, build: () => err("bad header") };
    expect(
      await runDataset(broken, {}, { refresh: true, now, fetchBytes: serve, readShards }),
    ).toEqual(err({ kind: "invalid-source", dataset: "sample", message: "bad header" }));
  });
});
