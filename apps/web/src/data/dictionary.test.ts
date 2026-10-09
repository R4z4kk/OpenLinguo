import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";
import { openDatabase, type Database, type StoredEntry } from "./database.ts";
import { createLookup, loadZhPack } from "./dictionary.ts";

const entry = (
  id: string,
  variants: readonly string[],
  levels: readonly [number | null, number | null],
): StoredEntry => {
  const [simplified = "", key = ""] = id.split("\t");
  return {
    id,
    simplified,
    reading: key,
    variants,
    glosses: [[`${simplified} (en)`], [`${simplified} (cfdict)`], [`${simplified} (wiktionary)`]],
    hsk2025: levels[0],
    gf0025: levels[1],
    lexicon: true,
  };
};

let db: Database;

beforeAll(async () => {
  db = openDatabase("dictionary-test");
  await db.entries.bulkPut([
    entry("电话\tdian4 hua4", ["電話"], [2, 1]),
    entry("话\thua4", ["話"], [1, 1]),
    entry("电\tdian4", ["電"], [1, 2]),
  ]);
  await db.characters.bulkPut([
    { character: "话", decomposition: "⿰讠舌", radical: "讠", etymology: null },
    { character: "电", decomposition: "⿻曰乚", radical: "曰", etymology: null },
  ]);
  await db.meta.put({ key: "lexicon", value: ["电话", "话", "电"] });
});

describe("dictionary", () => {
  it("finds a word by its simplified or traditional form, glosses labeled with their source", async () => {
    expect(await createLookup(db, "hsk-2025")("電話")).toEqual({
      ok: true,
      value: [
        {
          headword: "电话",
          variants: ["電話"],
          reading: "dian4 hua4",
          glosses: [
            { lang: "en", text: "电话 (en)", source: "cc-cedict" },
            { lang: "fr", text: "电话 (cfdict)", source: "cfdict" },
            { lang: "fr", text: "电话 (wiktionary)", source: "wiktionary-fr" },
          ],
          level: 2,
        },
      ],
    });
    expect(await createLookup(db, "hsk-2025")("龘")).toEqual({ ok: true, value: [] });
  });

  it("gives the level of the active referential", async () => {
    const level = async (referential: "hsk-2025" | "gf0025-2021"): Promise<number | null> => {
      const result = await createLookup(db, referential)("电话");
      return result.ok ? (result.value[0]?.level ?? null) : null;
    };
    expect(await level("hsk-2025")).toBe(2);
    expect(await level("gf0025-2021")).toBe(1);
  });

  it("builds the zh pack on the imported lexicon and decompositions", async () => {
    const pack = await loadZhPack(db, "gf0025-2021");
    if (!pack.ok) throw new Error(pack.error.kind);
    expect(pack.value.proficiency).toBe("gf0025-2021");
    expect(pack.value.tokenize("电话").map((token) => token.text)).toEqual(["电话"]);
    const tree = await pack.value.features.decomposition?.decompose("话");
    expect(tree?.ok && tree.value.children.map((child) => child.form)).toEqual(["讠", "舌"]);
  });

  it("reports data that was never imported", async () => {
    expect(await loadZhPack(openDatabase("empty-test"), "hsk-2025")).toEqual({
      ok: false,
      error: { kind: "dataset-missing", dataset: "lexicon" },
    });
  });
});
