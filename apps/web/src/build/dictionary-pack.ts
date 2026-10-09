import { err, ok, type Result } from "@openlinguo/core";
import { readingKey } from "@openlinguo/lang-zh";
import { GLOSS_SOURCES, type EntryRow, type GlossSource } from "../data/format.ts";

/** `[simplified, traditional, numbered pinyin, glosses]` (CC-CEDICT and French-only entries). */
export type SourceEntry = readonly [string, string, string, readonly string[]];
/** `[simplified, reading key, French glosses]` attached to a CC-CEDICT entry. */
export type SourceGlosses = readonly [string, string, readonly string[]];
/** `[word, lowest level, other levels, reading keys]` from a graded word list. */
export type GradedWord = readonly [string, number, readonly number[], readonly string[]];

export type DictionarySources = {
  readonly cedict: readonly SourceEntry[];
  readonly frenchGlosses: readonly (readonly [
    Exclude<GlossSource, "cc-cedict">,
    readonly SourceGlosses[],
  ])[];
  readonly frenchOnly: readonly (readonly [
    Exclude<GlossSource, "cc-cedict">,
    readonly SourceEntry[],
  ])[];
  readonly hsk2025: readonly GradedWord[];
  readonly gf0025: readonly GradedWord[];
};

export type Dictionary = {
  readonly entries: readonly EntryRow[];
  /** CC-CEDICT simplified headwords: the segmentation lexicon. */
  readonly lexicon: readonly string[];
  /** CC-CEDICT rows left out because their pinyin is invalid. */
  readonly skipped: readonly SourceEntry[];
};

type Draft = {
  simplified: string;
  key: string;
  reading: string;
  readonly variants: Set<string>;
  readonly glosses: readonly [Set<string>, Set<string>, Set<string>];
  hsk2025: number | null;
  gf0025: number | null;
  readonly lexicon: boolean;
};

const sourceIndex = (source: GlossSource): 0 | 1 | 2 => {
  const index = GLOSS_SOURCES.indexOf(source);
  return index === 1 ? 1 : index === 2 ? 2 : 0;
};

const lower = (value: number | null, level: number): number =>
  value === null ? level : Math.min(value, level);

/**
 * One entry per (simplified, reading key): CC-CEDICT rows sharing it are merged (traditional
 * forms become variants), French glosses and French-only words are attached with their source,
 * and HSK levels are set on the readings the lists name.
 */
export const buildDictionary = (sources: DictionarySources): Result<Dictionary, string> => {
  const drafts = new Map<string, Draft>();
  const skipped: SourceEntry[] = [];
  const draft = (row: SourceEntry, key: string, lexicon: boolean): Draft => {
    const [simplified, traditional, reading] = row;
    const id = `${simplified}\t${key}`;
    const existing = drafts.get(id);
    const entry = existing ?? {
      simplified,
      key,
      reading,
      variants: new Set<string>(),
      glosses: [new Set<string>(), new Set<string>(), new Set<string>()] as const,
      hsk2025: null,
      gf0025: null,
      lexicon,
    };
    // A lowercase reading (common word) is shown before a capitalized one (proper noun).
    if (/^[a-z]/u.test(reading) && !/^[a-z]/u.test(entry.reading)) entry.reading = reading;
    if (traditional !== simplified) entry.variants.add(traditional);
    drafts.set(id, entry);
    return entry;
  };

  for (const row of sources.cedict) {
    const key = readingKey(row[2]);
    if (!key.ok) {
      skipped.push(row);
      continue;
    }
    const entry = draft(row, key.value, true);
    for (const gloss of row[3]) entry.glosses[0].add(gloss);
  }
  for (const [source, rows] of sources.frenchGlosses) {
    for (const [simplified, key, glosses] of rows) {
      const entry = drafts.get(`${simplified}\t${key}`);
      if (entry?.lexicon !== true)
        return err(`${source} glosses ${simplified} ${key}, absent from CC-CEDICT`);
      for (const gloss of glosses) entry.glosses[sourceIndex(source)].add(gloss);
    }
  }
  for (const [source, rows] of sources.frenchOnly) {
    for (const row of rows) {
      const key = readingKey(row[2]);
      if (!key.ok) return err(`${source} French-only ${row[0]} has an invalid reading ${row[2]}`);
      const entry = draft(row, key.value, false);
      if (entry.lexicon) return err(`${source} French-only ${row[0]} ${key.value} is in CC-CEDICT`);
      for (const gloss of row[3]) entry.glosses[sourceIndex(source)].add(gloss);
    }
  }
  for (const [framework, words] of [
    ["hsk2025", sources.hsk2025],
    ["gf0025", sources.gf0025],
  ] as const) {
    for (const [word, level, , keys] of words) {
      for (const key of keys) {
        const entry = drafts.get(`${word}\t${key}`);
        if (entry == null)
          return err(`${framework} grades ${word} ${key}, absent from the dictionary`);
        entry[framework] = lower(entry[framework], level);
      }
    }
  }

  const entries = [...drafts.values()].map((entry): EntryRow => [
    entry.simplified,
    entry.key,
    entry.reading,
    [...entry.variants],
    [[...entry.glosses[0]], [...entry.glosses[1]], [...entry.glosses[2]]],
    entry.hsk2025,
    entry.gf0025,
    entry.lexicon,
  ]);
  const lexicon = [...new Set(entries.filter((row) => row[7]).map(([simplified]) => simplified))];
  return ok({ entries, lexicon, skipped });
};
