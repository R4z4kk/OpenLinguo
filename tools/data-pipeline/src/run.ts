import { createHash } from "node:crypto";
import { err, ok, type Result } from "@openlinguo/core";
import type { Manifest, ManifestEntry } from "./manifest.ts";

export type DatasetBuild = {
  readonly version: string;
  /** Text files are written as UTF-8, binary ones (fonts) as is. */
  readonly files: ReadonlyMap<string, string | Uint8Array>;
  readonly summary: string;
};

/** Shard contents of an already built dataset, read from `data/<dataset>/`. */
export type ShardReader = (dataset: string) => Promise<Result<readonly string[], string>>;

export type Dataset = {
  readonly id: string;
  readonly url: string;
  readonly license: string;
  readonly maxAgeDays: number;
  readonly build: (
    raw: Uint8Array,
    readShards: ShardReader,
  ) => Result<DatasetBuild, string> | Promise<Result<DatasetBuild, string>>;
};

export type PipelineError =
  | { readonly kind: "download-failed"; readonly url: string; readonly message: string }
  | { readonly kind: "not-pinned"; readonly dataset: string }
  | {
      readonly kind: "checksum-mismatch";
      readonly dataset: string;
      readonly expected: string;
      readonly actual: string;
    }
  | { readonly kind: "invalid-source"; readonly dataset: string; readonly message: string };

export type FetchBytes = (url: string) => Promise<Result<Uint8Array, PipelineError>>;

export type RunOptions = {
  readonly refresh: boolean;
  readonly now: Date;
  readonly fetchBytes: FetchBytes;
  readonly readShards: ShardReader;
};

export type RunOutput = {
  readonly entry: ManifestEntry;
  readonly files: DatasetBuild["files"];
  readonly summary: string;
};

export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export const fetchBytes: FetchBytes = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) {
      return err({ kind: "download-failed", url, message: `HTTP ${String(response.status)}` });
    }
    return ok(new Uint8Array(await response.arrayBuffer()));
  } catch (error) {
    return err({ kind: "download-failed", url, message: String(error) });
  }
};

export const runDataset = async (
  dataset: Dataset,
  manifest: Manifest,
  options: RunOptions,
): Promise<Result<RunOutput, PipelineError>> => {
  const raw = await options.fetchBytes(dataset.url);
  if (!raw.ok) return raw;

  const actual = sha256(raw.value);
  const pinned = manifest[dataset.id] ?? null;
  if (!options.refresh) {
    if (pinned === null) return err({ kind: "not-pinned", dataset: dataset.id });
    if (pinned.sha256 !== actual) {
      return err({
        kind: "checksum-mismatch",
        dataset: dataset.id,
        expected: pinned.sha256,
        actual,
      });
    }
  }

  const built = await dataset.build(raw.value, options.readShards);
  if (!built.ok) return err({ kind: "invalid-source", dataset: dataset.id, message: built.error });

  return ok({
    entry: {
      source: dataset.url,
      license: dataset.license,
      version: built.value.version,
      retrievedAt:
        options.refresh || pinned === null ? options.now.toISOString() : pinned.retrievedAt,
      maxAgeDays: dataset.maxAgeDays,
      sha256: actual,
    },
    files: built.value.files,
    summary: built.value.summary,
  });
};

export const formatError = (error: PipelineError): string => {
  switch (error.kind) {
    case "download-failed":
      return `Download failed for ${error.url}: ${error.message}`;
    case "not-pinned":
      return `${error.dataset} has no manifest entry. Run with --refresh to pin it.`;
    case "checksum-mismatch":
      return `${error.dataset} changed upstream (expected sha256 ${error.expected}, got ${error.actual}). Run with --refresh and review the diff.`;
    case "invalid-source":
      return `${error.dataset} source is invalid: ${error.message}`;
  }
};
