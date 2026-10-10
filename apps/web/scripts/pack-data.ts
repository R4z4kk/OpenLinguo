// Packs the committed datasets into the files the app imports on first run (public/data/).
import { createHash } from "node:crypto";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import { CharacterRow, StrokeRow, type DataFile, type DataIndex } from "../src/data/format.ts";
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
] as const;

const sha256 = (content: string): string => createHash("sha256").update(content).digest("hex");

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
    const content = `[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`;
    files.push({ name, kind, sha256: sha256(content), rows: rows.length, content });
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
    version: sha256(files.map((file) => `${file.name}:${file.sha256}`).join("\n")),
    files: files.map(({ name, kind, sha256: hash, rows }) => ({ name, kind, sha256: hash, rows })),
  };
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  for (const file of files) await writeFile(new URL(file.name, OUT), file.content, "utf8");
  await writeFile(new URL("index.json", OUT), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  for (const [source, published] of LICENSES) {
    const target = new URL(`licenses/${published}`, OUT);
    await mkdir(new URL(".", target), { recursive: true });
    await copyFile(new URL(source, DATA), target);
  }

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
