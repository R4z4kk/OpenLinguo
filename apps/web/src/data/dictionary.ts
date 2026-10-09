import {
  err,
  ok,
  type DictEntry,
  type DictionaryLookup,
  type LanguagePack,
  type LookupError,
  type Result,
} from "@openlinguo/core";
import { createZhPack, type ZhProficiency } from "@openlinguo/lang-zh";
import type { Database, StoredEntry } from "./database.ts";
import { GLOSS_LANGUAGE, GLOSS_SOURCES } from "./format.ts";

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

/** The zh pack over the imported data: CC-CEDICT lexicon, Make Me a Hanzi decompositions. */
export const loadZhPack = async (
  db: Database,
  referential: ZhProficiency,
): Promise<Result<LanguagePack, LookupError>> => {
  try {
    const lexicon = await db.meta.get("lexicon");
    if (lexicon?.key !== "lexicon") return err({ kind: "dataset-missing", dataset: "lexicon" });
    const characters = await db.characters.toArray();
    if (characters.length === 0) return err({ kind: "dataset-missing", dataset: "characters" });
    return ok(
      createZhPack({
        lookup: createLookup(db, referential),
        lexicon: new Set(lexicon.value),
        decompositions: new Map(characters.map((row) => [row.character, row.decomposition])),
        proficiency: referential,
      }),
    );
  } catch (error) {
    return err({ kind: "storage-failure", message: String(error) });
  }
};
