// Packs the committed datasets into the files the app imports on first run (public/data/).
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import { buildDictionary } from "../src/build/dictionary-pack.ts";
import { CharacterRow, type DataFile, type DataIndex } from "../src/data/format.ts";

const DATA = new URL("../../../data/", import.meta.url);
const OUT = new URL("../public/data/", import.meta.url);
const SHARD_SIZE = 10_000;

const SourceEntry = z.tuple([z.string(), z.string(), z.string(), z.array(z.string())]);
const SourceGlosses = z.tuple([z.string(), z.string(), z.array(z.string())]);
const GradedWord = z.tuple([
  z.string(),
  z.number().int(),
  z.array(z.number().int()),
  z.array(z.string()),
]);
const WordFrequency = z.tuple([z.string(), z.number()]);

const readRows = async <Row extends z.ZodType>(
  dataset: string,
  prefix: string,
  row: Row,
): Promise<z.output<Row>[]> => {
  const dir = new URL(`${dataset}/`, DATA);
  const names = (await readdir(dir))
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort();
  if (names.length === 0) throw new Error(`data/${dataset} has no ${prefix}*.json shard`);
  const rows: z.output<Row>[] = [];
  for (const name of names) {
    const parsed = z.array(row).safeParse(JSON.parse(await readFile(new URL(name, dir), "utf8")));
    if (!parsed.success) throw new Error(`data/${dataset}/${name}: ${parsed.error.message}`);
    rows.push(...parsed.data);
  }
  return rows;
};

const sha256 = (content: string): string => createHash("sha256").update(content).digest("hex");

const main = async (): Promise<void> => {
  const dictionary = buildDictionary({
    cedict: await readRows("cc-cedict", "entries-", SourceEntry),
    frenchGlosses: [
      ["cfdict", await readRows("cfdict", "glosses-", SourceGlosses)],
      ["wiktionary-fr", await readRows("wiktionary-fr-zh", "glosses-", SourceGlosses)],
    ],
    frenchOnly: [
      ["cfdict", await readRows("cfdict", "entries-", SourceEntry)],
      ["wiktionary-fr", await readRows("wiktionary-fr-zh", "entries-", SourceEntry)],
    ],
    hsk2025: await readRows("hsk-2025-words", "words-", GradedWord),
    gf0025: await readRows("gf0025-2021-words", "words-", GradedWord),
    frequencies: await readRows("wordfreq-zh", "words-", WordFrequency),
  });
  if (!dictionary.ok) throw new Error(dictionary.error);
  const characters = await readRows("makemeahanzi", "characters-", CharacterRow);

  const files: (DataFile & { readonly content: string })[] = [];
  const add = (name: string, kind: DataFile["kind"], rows: readonly unknown[]): void => {
    const content = `[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]\n`;
    files.push({ name, kind, sha256: sha256(content), rows: rows.length, content });
  };
  add("characters.json", "characters", characters);
  add("lexicon.json", "lexicon", dictionary.value.lexicon);
  const { entries } = dictionary.value;
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

  const skipped = dictionary.value.skipped.map(
    ([simplified, , reading]) => `${simplified} [${reading}]`,
  );
  console.log(
    `data: ${String(entries.length)} entries (${String(dictionary.value.lexicon.length)} lexicon headwords), ${String(characters.length)} characters, ${String(files.length)} files, version ${index.version.slice(0, 12)}`,
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
