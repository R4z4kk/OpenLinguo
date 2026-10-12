import { gzipSync } from "node:zlib";

export const toShards = (
  name: string,
  rows: readonly unknown[],
  size: number,
): ReadonlyMap<string, string> => {
  const files = new Map<string, string>();
  for (let start = 0; start < rows.length; start += size) {
    const lines = rows.slice(start, start + size).map((row) => JSON.stringify(row));
    const index = String(start / size).padStart(3, "0");
    files.set(`${name}-${index}.json`, `[\n${lines.join(",\n")}\n]\n`);
  }
  return files;
};

const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

/** Shard bytes as stored, and gzipped one file at a time as a server sends them. */
export const payloadOf = (shards: ReadonlyMap<string, string>): string => {
  let raw = 0;
  let gzipped = 0;
  for (const content of shards.values()) {
    const bytes = new TextEncoder().encode(content);
    raw += bytes.length;
    gzipped += gzipSync(bytes).length;
  }
  return `${megabytes(raw)} of JSON in ${String(shards.size)} files, ${megabytes(gzipped)} gzipped`;
};
