import {
  err,
  ok,
  type DictEntry,
  type DictionaryLookup,
  type LanguagePack,
  type LookupError,
  type Result,
  type StrokeFeature,
} from "@openlinguo/core";
import { createZhPack, type ImeWordsOf, type ZhProficiency } from "@openlinguo/lang-zh";
import type { Database, StoredEntry } from "./database.ts";
import { GLOSS_LANGUAGE, GLOSS_SOURCES } from "./format.ts";
import { idsFor, loadSearchIndex } from "./search-index.ts";

export const toDictEntry = (entry: StoredEntry, referential: ZhProficiency): DictEntry => ({
  headword: entry.simplified,
  variants: entry.variants,
  reading: entry.reading,
  glosses: GLOSS_SOURCES.flatMap((source, index) =>
    (entry.glosses[index] ?? []).map((text) => ({ lang: GLOSS_LANGUAGE[source], text, source })),
  ),
  level: referential === "hsk-2025" ? entry.hsk2025 : entry.gf0025,
});

/** Entries whose simplified or traditional form is `term`, with the referential's levels. */
export const createLookup =
  (db: Database, referential: ZhProficiency): DictionaryLookup =>
  async (term) => {
    try {
      const rows = await db.entries
        .where("simplified")
        .equals(term)
        .or("variants")
        .equals(term)
        .toArray();
      const unique = new Map(rows.map((row) => [row.id, row]));
      return ok([...unique.values()].map((row) => toDictEntry(row, referential)));
    } catch (error) {
      return err({ kind: "storage-failure", message: String(error) });
    }
  };

export const createStrokesOf =
  (db: Database): StrokeFeature["strokesOf"] =>
  async (character) => {
    try {
      const row = await db.strokes.get(character);
      return ok(row == null ? null : { strokes: row.strokes, medians: row.medians });
    } catch (error) {
      return err({ kind: "storage-failure", message: String(error) });
    }
  };

/** CC-CEDICT words whose toneless reading is `key`, through the pinyin search index. */
export const createWordsOfPinyin =
  (db: Database): ImeWordsOf =>
  async (key) => {
    try {
      const index = await loadSearchIndex(db);
      const rows = await db.entries.bulkGet([...idsFor(index.pinyin, key, false)]);
      const entries = rows.filter((row) => row != null);
      if (entries.length !== rows.length)
        return err({ kind: "dataset-missing", dataset: "entries" });
      return ok(
        entries
          .filter((entry) => entry.lexicon)
          .map((entry) => ({
            headword: entry.simplified,
            reading: entry.reading,
            frequency: entry.frequency,
          })),
      );
    } catch (error) {
      return err({ kind: "storage-failure", message: String(error) });
    }
  };

/**
 * The zh pack over the imported data: CC-CEDICT lexicon, Make Me a Hanzi decompositions, strokes,
 * and an input method over the pinyin search index.
 */
export const loadZhPack = async (
  db: Database,
  referential: ZhProficiency,
): Promise<Result<LanguagePack, LookupError>> => {
  try {
    const lexicon = await db.meta.get("lexicon");
    if (lexicon?.key !== "lexicon") return err({ kind: "dataset-missing", dataset: "lexicon" });
    const characters = await db.characters.toArray();
    if (characters.length === 0) return err({ kind: "dataset-missing", dataset: "characters" });
    if ((await db.strokes.count()) === 0)
      return err({ kind: "dataset-missing", dataset: "strokes" });
    return ok(
      createZhPack({
        lookup: createLookup(db, referential),
        lexicon: new Set(lexicon.value),
        decompositions: new Map(characters.map((row) => [row.character, row.decomposition])),
        proficiency: referential,
        strokesOf: createStrokesOf(db),
        wordsOfPinyin: createWordsOfPinyin(db),
      }),
    );
  } catch (error) {
    return err({ kind: "storage-failure", message: String(error) });
  }
};
