// Packs the committed datasets into the files the app imports on first run (public/data/),
// and the datasets it downloads on demand (public/data/wiktionary-zh/, public/data/jieba-names/,
// public/data/audio-zh/, public/models/).
import { createHash } from "node:crypto";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import {
  CharacterRow,
  ExtendedRow,
  NameRow,
  StrokeRow,
  type DataFile,
  type DataIndex,
  type OnDemandFile,
  type OnDemandIndex,
} from "../src/data/format.ts";
import { publishAudioPacks } from "./audio-packs.ts";
import { publishSpeechModel } from "./speech-model.ts";
import { DATA, loadDictionary, readRows } from "./sources.ts";

const OUT = new URL("../public/data/", import.meta.url);
const SHARD_SIZE = 10_000;

/** `[character, strokes, medians, radical strokes]`: the radical strokes are not used. */
const HanziWriterRow = z.tuple([
  z.string(),
  z.array(z.string()),
  z.array(z.unknown()),
  z.unknown(),
]);
/** License texts that must travel with the shipped data: `[data/ path, licenses/ path]`. */
const LICENSES = [
  ["makemeahanzi/makemeahanzi-LGPL", "makemeahanzi/LGPL.txt"],
  ["makemeahanzi/GPL-3.0.txt", "makemeahanzi/GPL-3.0.txt"],
  ["hanzi-writer-data/ARPHICPL.TXT", "hanzi-writer-data/ARPHICPL.txt"],
  ["jieba-names/jieba-MIT.txt", "jieba/LICENSE.txt"],
  ["paraformer/THIRD-PARTY-LICENSES.txt", "paraformer/THIRD-PARTY-LICENSES.txt"],
] as const;

const sha256 = (content: string): string => createHash("sha256").update(content).digest("hex");

const pack = (
  name: string,
  rows: readonly unknown[],
): OnDemandFile & { readonly content: string } => {
  const content = `[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`;
  return { name, sha256: sha256(content), rows: rows.length, content };
};

const versionOf = (files: readonly OnDemandFile[]): string =>
  sha256(files.map((file) => `${file.name}:${file.sha256}`).join("\n"));

const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

type OnDemand = {
  readonly dir: string;
  readonly rows: number;
  readonly files: readonly (OnDemandFile & { readonly content: string })[];
  readonly index: OnDemandIndex;
};

/** A dataset packed apart with its own `index.json`, downloaded when a feature needs it. */
const packOnDemand = async (dataset: string, prefix: string, row: z.ZodType): Promise<OnDemand> => {
  const rows = await readRows(dataset, prefix, row);
  const files: (OnDemandFile & { readonly content: string })[] = [];
  for (let start = 0; start < rows.length; start += SHARD_SIZE) {
    const shard = String(start / SHARD_SIZE).padStart(3, "0");
    files.push(pack(`${prefix}${shard}.json`, rows.slice(start, start + SHARD_SIZE)));
  }
  const index: OnDemandIndex = {
    version: versionOf(files),
    files: files.map(({ name, sha256: hash, rows: count }) => ({
      name,
      sha256: hash,
      rows: count,
    })),
  };
  return { dir: `${dataset}/`, rows: rows.length, files, index };
};

const writeOnDemand = async ({ dir, files, index }: OnDemand): Promise<void> => {
  const out = new URL(dir, OUT);
  await mkdir(out, { recursive: true });
  for (const file of files) await writeFile(new URL(file.name, out), file.content, "utf8");
  await writeFile(new URL("index.json", out), `${JSON.stringify(index, null, 2)}\n`, "utf8");
};

const payloadOf = ({ files }: OnDemand): string => {
  const contents = files.map((file) => new TextEncoder().encode(file.content));
  const raw = contents.reduce((sum, bytes) => sum + bytes.length, 0);
  const gzipped = contents.reduce((sum, bytes) => sum + gzipSync(bytes).length, 0);
  return `${String(files.length)} files (${megabytes(raw)}, ${megabytes(gzipped)} gzipped)`;
};

const main = async (): Promise<void> => {
  const dictionary = await loadDictionary();
  const characters = await readRows("makemeahanzi", "characters-", CharacterRow);
  const strokes = z
    .array(StrokeRow)
    .safeParse(
      (await readRows("hanzi-writer-data", "strokes-", HanziWriterRow)).map(
        ([character, outlines, medians]) => [character, outlines, medians],
      ),
    );
  if (!strokes.success) throw new Error(`data/hanzi-writer-data: ${strokes.error.message}`);

  const files: (DataFile & { readonly content: string })[] = [];
  const add = (name: string, kind: DataFile["kind"], rows: readonly unknown[]): void => {
    files.push({ ...pack(name, rows), kind });
  };
  add("characters.json", "characters", characters);
  add("strokes.json", "strokes", strokes.data);
  add("lexicon.json", "lexicon", dictionary.lexicon);
  const { entries } = dictionary;
  for (let start = 0; start < entries.length; start += SHARD_SIZE) {
    const shard = String(start / SHARD_SIZE).padStart(3, "0");
    add(`entries-${shard}.json`, "entries", entries.slice(start, start + SHARD_SIZE));
  }

  const index: DataIndex = {
    version: versionOf(files),
    files: files.map(({ name, kind, sha256: hash, rows }) => ({ name, kind, sha256: hash, rows })),
  };

  const extended = await packOnDemand("wiktionary-zh", "words-", ExtendedRow);
  const names = await packOnDemand("jieba-names", "names-", NameRow);
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  for (const file of files) await writeFile(new URL(file.name, OUT), file.content, "utf8");
  await writeFile(new URL("index.json", OUT), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  await writeOnDemand(extended);
  await writeOnDemand(names);
  const audio = await publishAudioPacks(OUT);
  const speech = await publishSpeechModel();
  for (const [source, published] of LICENSES) {
    const target = new URL(`licenses/${published}`, OUT);
    await mkdir(new URL(".", target), { recursive: true });
    await copyFile(new URL(source, DATA), target);
  }

  console.log(
    `data: extended lexicon ${String(extended.rows)} words in ${payloadOf(extended)}, downloaded on demand`,
  );
  console.log(
    `data: proper names ${String(names.rows)} in ${payloadOf(names)}, downloaded on demand`,
  );
  console.log(audio);
  console.log(speech);
  const skipped = dictionary.skipped.map(([simplified, , reading]) => `${simplified} [${reading}]`);
  console.log(
    `data: ${String(entries.length)} entries (${String(dictionary.lexicon.length)} lexicon headwords), ${String(characters.length)} characters, ${String(strokes.data.length)} stroke orders, ${String(files.length)} files, version ${index.version.slice(0, 12)}`,
  );
  if (skipped.length > 0) {
    console.log(
      `data: ${String(skipped.length)} CC-CEDICT rows with an invalid reading left out: ${skipped.join(", ")}`,
    );
  }
};

main().catch((error: unknown) => {
  console.error(`data: ${String(error)}`);
  process.exitCode = 1;
});
