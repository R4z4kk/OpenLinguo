// Fetches the word audio packs named in data/audio-zh/packs.json from their GitHub release, checks each
// against its sha256 and publishes them in public/data/audio-zh/ with the index the app reads (ADR 0007).
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { AudioPackIndex } from "../src/data/format.ts";
import { DATA } from "./sources.ts";

const CACHE = new URL("../.cache/audio-zh/", import.meta.url);
const RELEASES = "https://github.com/R4z4kk/OpenLinguo/releases/download";
const DATASET = "audio-zh";

const Manifest = z.record(z.string(), z.looseObject({ sha256: z.string() }));
/** The fields of `data/audio-zh/packs.json` the app needs; the pipeline owns the full schema. */
const PackIndexFile = z.looseObject({
  release: z.string().min(1),
  bands: AudioPackIndex.shape.bands,
});

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const readCached = async (file: string, hash: string): Promise<Uint8Array | null> => {
  try {
    const bytes = new Uint8Array(await readFile(new URL(file, CACHE)));
    return sha256(bytes) === hash ? bytes : null;
  } catch {
    return null;
  }
};

const download = async (release: string, file: string, hash: string): Promise<Uint8Array> => {
  const url = `${RELEASES}/${release}/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (sha256(bytes) !== hash) {
    throw new Error(`${url} does not match its sha256 in data/audio-zh/packs.json`);
  }
  await writeFile(new URL(file, CACHE), bytes);
  return bytes;
};

/** Publishes the packs in `out/audio-zh/`; a pack missing or not matching its sha256 stops the build. */
export const publishAudioPacks = async (out: URL): Promise<string> => {
  const indexBytes = new Uint8Array(await readFile(new URL(`${DATASET}/packs.json`, DATA)));
  const manifest = Manifest.parse(
    JSON.parse(await readFile(new URL("manifest.json", DATA), "utf8")) as unknown,
  );
  if (manifest[DATASET]?.sha256 !== sha256(indexBytes)) {
    throw new Error(`data/${DATASET}/packs.json does not match its sha256 in data/manifest.json`);
  }
  const { release, bands } = PackIndexFile.parse(
    JSON.parse(new TextDecoder().decode(indexBytes)) as unknown,
  );
  const target = new URL(`${DATASET}/`, out);
  await mkdir(CACHE, { recursive: true });
  await mkdir(target, { recursive: true });
  let bytes = 0;
  for (const { parts } of bands) {
    for (const { file, sha256: hash } of parts) {
      const content = (await readCached(file, hash)) ?? (await download(release, file, hash));
      await writeFile(new URL(file, target), content);
      bytes += content.length;
    }
  }
  const index: AudioPackIndex = {
    release,
    bands: bands.map(({ referential, level, entries, parts }) => ({
      referential,
      level,
      entries,
      parts,
    })),
  };
  await writeFile(new URL("index.json", target), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return `data: word audio ${String(bands.length)} band(s), ${(bytes / 1_000_000).toFixed(1)} MB from release ${release}, downloaded on request`;
};
