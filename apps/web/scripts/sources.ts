// Reads the committed dataset shards under data/.
import { readdir, readFile } from "node:fs/promises";
import { z } from "zod";
import { buildDictionary, type Dictionary } from "../src/build/dictionary-pack.ts";

export const DATA = new URL("../../../data/", import.meta.url);

const SourceEntry = z.tuple([z.string(), z.string(), z.string(), z.array(z.string())]);
const SourceGlosses = z.tuple([z.string(), z.string(), z.array(z.string())]);
export const GradedWord = z.tuple([
  z.string(),
  z.number().int(),
  z.array(z.number().int()),
  z.array(z.string()),
]);
const WordFrequency = z.tuple([z.string(), z.number()]);

export const readRows = async <Row extends z.ZodType>(
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

/** The dictionary exactly as the app imports it. */
export const loadDictionary = async (): Promise<Dictionary> => {
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
  return dictionary.value;
};
