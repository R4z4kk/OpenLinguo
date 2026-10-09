import "fake-indexeddb/auto";
import { readingKey } from "@openlinguo/lang-zh";
import { beforeAll, describe, expect, it } from "vitest";
import { openDatabase, type Database, type StoredEntry } from "./database.ts";
import { indexRecord } from "./search-index.ts";
import { searchDictionary } from "./search.ts";

type Row = Partial<{
  readonly en: readonly string[];
  readonly fr: readonly string[];
  readonly levels: readonly [number | null, number | null];
  readonly frequency: number | null;
  readonly variants: readonly string[];
  readonly lexicon: boolean;
}>;

const entry = (
  simplified: string,
  reading: string,
  { en = [], fr = [], levels = [null, null], frequency = null, variants = [], lexicon = true }: Row,
): StoredEntry => {
  const key = readingKey(reading);
  const glosses = [en, fr, []] as const;
  return {
    id: `${simplified}\t${key.ok ? key.value : reading}`,
    simplified,
    reading,
    variants,
    glosses,
    hsk2025: levels[0],
    gf0025: levels[1],
    lexicon,
    frequency,
  };
};

const rows: StoredEntry[] = [
  entry("电", "dian4", { en: ["electricity"], levels: [1, 1], frequency: 5.5, variants: ["電"] }),
  entry("电话", "dian4 hua4", {
    en: ["telephone", "phone call", "phone number"],
    fr: ["téléphone"],
    levels: [1, 1],
    frequency: 5.44,
    variants: ["電話"],
  }),
  entry("电脑", "dian4 nao3", {
    en: ["computer"],
    fr: ["ordinateur"],
    levels: [1, 2],
    frequency: 5.6,
  }),
  entry("电视", "dian4 shi4", { en: ["television", "TV"], levels: [1, 1], frequency: 5.5 }),
  entry("电报", "dian4 bao4", { en: ["telegram"], frequency: 4 }),
  entry("店", "dian4", { en: ["shop", "store"], levels: [1, 1], frequency: 5.2 }),
  entry("点", "dian3", { en: ["point", "dot"], levels: [1, 1], frequency: 6.2 }),
  entry("典", "dian3", { en: ["canon", "classics"], levels: [6, 5], frequency: 4.5 }),
  entry("打电话", "da3 dian4 hua4", {
    en: ["to make a telephone call"],
    levels: [1, 2],
    frequency: 4.9,
  }),
  entry("叫", "jiao4", { en: ["to shout", "to call"], levels: [1, 1], frequency: 6 }),
  entry("女", "nu:3", { en: ["female", "woman"], levels: [1, 1], frequency: 5.8 }),
  entry("女儿", "nu:3 er2", { en: ["daughter"], fr: ["fille"], levels: [1, 1], frequency: 5.1 }),
  entry("北京", "Bei3 jing1", { en: ["Beijing"], levels: [1, 1], frequency: 5.75 }),
  entry("背景", "bei4 jing3", { en: ["background"], levels: [5, 4], frequency: 4.8 }),
  entry("背静", "bei4 jing4", { en: ["quiet", "secluded"] }),
  entry("北景", "Bei3 jing3", { en: ["Beijing (place name)"] }),
  entry("北晶", "bei3 jing1", { fr: ["cristal du nord"], lexicon: false }),
  entry("先", "xian1", { en: ["first"], levels: [3, 1], frequency: 6.1 }),
  entry("西安", "Xi1 an1", { en: ["Xi'an"], frequency: 4.9 }),
];

let db: Database;

/** Stored like an import: two files, each with its search index. */
const store = async (name: string, entries: readonly StoredEntry[]): Promise<Database> => {
  const stored = openDatabase(name);
  const half = Math.ceil(entries.length / 2);
  await stored.entries.bulkPut([...entries]);
  await stored.searchIndex.bulkPut([
    indexRecord("file-1", entries.slice(0, half)),
    indexRecord("file-2", entries.slice(half)),
  ]);
  await stored.meta.put({ key: "dataVersion", value: "v1" });
  return stored;
};

beforeAll(async () => {
  db = await store("search-test", rows);
});

const headwordsIn = async (
  searched: Database,
  query: string,
  referential: "hsk-2025" | "gf0025-2021" = "hsk-2025",
): Promise<string[]> => {
  const result = await searchDictionary(searched, referential, query, 50);
  if (!result.ok) throw new Error(result.error.kind);
  return result.value.entries.map((found) => `${found.headword} ${found.reading ?? ""}`);
};

const headwords = (query: string, referential: "hsk-2025" | "gf0025-2021" = "hsk-2025") =>
  headwordsIn(db, query, referential);

describe("searchDictionary", () => {
  it("finds characters, the exact word first, then by level and frequency", async () => {
    expect(await headwords("电")).toEqual([
      "电 dian4",
      "电脑 dian4 nao3",
      "电视 dian4 shi4",
      "电话 dian4 hua4",
      "电报 dian4 bao4",
    ]);
  });

  it("finds traditional forms", async () => {
    expect(await headwords("電話")).toEqual(["电话 dian4 hua4"]);
    expect(await headwords("電")).toEqual(["电 dian4", "电话 dian4 hua4"]);
  });

  it("finds pinyin without tones, exact syllables first", async () => {
    expect(await headwords("dian")).toEqual([
      "点 dian3",
      "电 dian4",
      "店 dian4",
      "典 dian3",
      "电脑 dian4 nao3",
      "电视 dian4 shi4",
      "电话 dian4 hua4",
      "电报 dian4 bao4",
    ]);
  });

  it("keeps the tones typed, as marks or numbers", async () => {
    const fourth = [
      "电 dian4",
      "店 dian4",
      "电脑 dian4 nao3",
      "电视 dian4 shi4",
      "电话 dian4 hua4",
    ];
    expect(await headwords("diàn")).toEqual([...fourth, "电报 dian4 bao4"]);
    expect(await headwords("dian4")).toEqual([...fourth, "电报 dian4 bao4"]);
    expect(await headwords("dian3")).toEqual(["点 dian3", "典 dian3"]);
  });

  it("finds a word typed with or without spaces and tones", async () => {
    for (const query of ["dianhua", "dian hua", "diànhuà", "dian4hua4", "DIAN4 HUA4"]) {
      expect((await headwords(query))[0]).toBe("电话 dian4 hua4");
    }
  });

  it("ends a syllable where a space or an apostrophe is typed", async () => {
    expect(await headwords("xian")).toEqual(["先 xian1", "西安 Xi1 an1"]);
    expect(await headwords("xi'an")).toEqual(["西安 Xi1 an1"]);
    expect(await headwords("xi an")).toEqual(["西安 Xi1 an1"]);
  });

  it("finds ü typed as ü, v or u:", async () => {
    for (const query of ["nü", "nv", "nu:3", "nǚ"]) {
      expect(await headwords(query)).toEqual(["女 nu:3", "女儿 nu:3 er2"]);
    }
  });

  it("breaks ties with CC-CEDICT words first, then common words before proper nouns", async () => {
    expect(await headwords("bei jing")).toEqual([
      "北京 Bei3 jing1",
      "背景 bei4 jing3",
      "背静 bei4 jing4",
      "北景 Bei3 jing3",
      "北晶 bei3 jing1",
    ]);
  });

  it("finds English glosses, a whole gloss first", async () => {
    expect(await headwords("telephone")).toEqual(["电话 dian4 hua4", "打电话 da3 dian4 hua4"]);
    expect(await headwords("call")).toEqual([
      "叫 jiao4",
      "电话 dian4 hua4",
      "打电话 da3 dian4 hua4",
    ]);
    expect(await headwords("to call")).toEqual([
      "叫 jiao4",
      "电话 dian4 hua4",
      "打电话 da3 dian4 hua4",
    ]);
    expect(await headwords("phone call")).toEqual(["电话 dian4 hua4"]);
  });

  it("finds French glosses with or without accents", async () => {
    expect(await headwords("téléphone")).toEqual(["电话 dian4 hua4", "打电话 da3 dian4 hua4"]);
    expect(await headwords("ordinateur")).toEqual(["电脑 dian4 nao3"]);
    expect(await headwords("fille")).toEqual(["女儿 nu:3 er2"]);
  });

  it("completes the last word typed", async () => {
    expect(await headwords("ordin")).toEqual(["电脑 dian4 nao3"]);
    expect(await headwords("tele")).toEqual([
      "电视 dian4 shi4",
      "电话 dian4 hua4",
      "打电话 da3 dian4 hua4",
      "电报 dian4 bao4",
    ]);
  });

  it("ranks by the levels of the chosen referential", async () => {
    expect(await headwords("电", "gf0025-2021")).toEqual([
      "电 dian4",
      "电视 dian4 shi4",
      "电话 dian4 hua4",
      "电脑 dian4 nao3",
      "电报 dian4 bao4",
    ]);
  });

  it("returns the best entries and the number of matches", async () => {
    const result = await searchDictionary(db, "hsk-2025", "dian", 2);
    expect(result.ok && result.value.total).toBe(8);
    expect(result.ok && result.value.entries.map((found) => found.headword)).toEqual(["点", "电"]);
  });

  it("finds nothing for a blank query or one that is neither Chinese nor a gloss", async () => {
    expect(await searchDictionary(db, "hsk-2025", "  ", 50)).toEqual({
      ok: true,
      value: { total: 0, entries: [] },
    });
    expect(await headwords("the")).toEqual([]);
    expect(await headwords("!?")).toEqual([]);
  });

  it("reports a storage failure", async () => {
    const closed = openDatabase("search-closed-test");
    closed.close();
    const result = await searchDictionary(closed, "hsk-2025", "dian", 50);
    expect(result.ok || result.error.kind).toBe("storage-failure");
  });

  it("reports entries missing from an index", async () => {
    const broken = await store("search-broken-test", rows);
    await broken.entries.delete("电\tdian4");
    expect(await searchDictionary(broken, "hsk-2025", "dian", 50)).toEqual({
      ok: false,
      error: { kind: "dataset-missing", dataset: "entries" },
    });
  });

  it("reads the index of a new data version", async () => {
    const updated = await store("search-update-test", rows);
    expect(await headwordsIn(updated, "ordinateur")).toEqual(["电脑 dian4 nao3"]);
    await updated.searchIndex.put(indexRecord("file-1", [rows[0] ?? entry("x", "x1", {})]));
    await updated.searchIndex.delete("file-2");
    expect(await headwordsIn(updated, "ordinateur")).toEqual(["电脑 dian4 nao3"]);
    await updated.meta.put({ key: "dataVersion", value: "v2" });
    expect(await headwordsIn(updated, "ordinateur")).toEqual([]);
  });
});
