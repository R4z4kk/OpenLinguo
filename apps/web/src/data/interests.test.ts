import "fake-indexeddb/auto";
import { cardId, NEW_CARD_STATE, ok, subjectId, type WordKey } from "@openlinguo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database, type StoredEntry } from "./database.ts";
import { toDictEntry } from "./dictionary.ts";
import {
  checkSuggestions,
  keepSuggestions,
  learningBand,
  loadInterests,
  NO_INTERESTS,
  saveInterests,
} from "./interests.ts";

const entry = (
  simplified: string,
  readingKey: string,
  hsk2025: number | null,
  french: string,
): StoredEntry => ({
  id: `${simplified}\t${readingKey}`,
  simplified,
  reading: readingKey,
  variants: [],
  glosses: [[`${french} (en)`], [french], []],
  hsk2025,
  gf0025: null,
  lexicon: true,
  frequency: null,
});

const LUCHA = entry("绿茶", "lu:4 cha2", 2, "thé vert");
const CHAGUAN = entry("茶馆", "cha2 guan3", null, "salon de thé");
const HANG = entry("行", "hang2", 3, "rangée");
const XING = entry("行", "xing2", 1, "aller");
const ZHONG = entry("重", "zhong4", 4, "lourd");
const CHONG = entry("重", "chong2", null, "répéter");
const ENTRIES = [LUCHA, CHAGUAN, HANG, XING, ZHONG, CHONG];

const wordOf = (row: StoredEntry): WordKey => ({
  headword: row.simplified,
  readingKey: row.id.slice(row.simplified.length + 1),
});

const kept = (...rows: readonly StoredEntry[]) =>
  rows.map((row) => ({ word: wordOf(row), entry: toDictEntry(row, "hsk-2025") }));

const ENTRIES_OF = Map.groupBy(ENTRIES, (row) => row.simplified);

describe("keepSuggestions", () => {
  it("keeps dictionary entries with the dictionary's reading, glosses and level", () => {
    expect(keepSuggestions(["绿茶", "茶馆"], ENTRIES_OF, new Set(), "hsk-2025")).toEqual({
      words: kept(LUCHA, CHAGUAN),
      dropped: 0,
    });
  });

  it("drops a headword the dictionary does not have", () => {
    expect(keepSuggestions(["绿茶", "爬山虎茶"], ENTRIES_OF, new Set(), "hsk-2025")).toEqual({
      words: kept(LUCHA),
      dropped: 1,
    });
  });

  it("drops a headword whose reading the learner started, any reading", () => {
    const started = new Set([subjectId(wordOf(HANG))]);
    expect(keepSuggestions(["行", "茶馆"], ENTRIES_OF, started, "hsk-2025")).toEqual({
      words: kept(CHAGUAN),
      dropped: 1,
    });
  });

  it("keeps a repeated headword once, without counting it as dropped", () => {
    expect(
      keepSuggestions(
        ["茶馆", "绿茶", "茶馆", "无此词", "无此词"],
        ENTRIES_OF,
        new Set(),
        "hsk-2025",
      ),
    ).toEqual({ words: kept(CHAGUAN, LUCHA), dropped: 1 });
  });

  it("shows the reading taught first, an ungraded one after the graded ones", () => {
    expect(keepSuggestions(["行", "重"], ENTRIES_OF, new Set(), "hsk-2025").words).toEqual(
      kept(XING, ZHONG),
    );
    expect(keepSuggestions(["重"], ENTRIES_OF, new Set(), "gf0025-2021").words).toEqual([
      { word: wordOf(ZHONG), entry: toDictEntry(ZHONG, "gf0025-2021") },
    ]);
  });
});

describe("checkSuggestions", () => {
  let db: Database;
  let counter = 0;

  beforeEach(async () => {
    counter += 1;
    db = openDatabase(`interests-test-${String(counter)}`);
    await db.entries.bulkAdd(ENTRIES);
  });

  const card = (row: StoredEntry, phase: "new" | "review") => {
    const key = { language: "zh", ...wordOf(row), type: "recognition" } as const;
    return { ...key, id: cardId(key), ...NEW_CARD_STATE, phase };
  };

  it("counts as started a card past new, not one only filed in a deck", async () => {
    await db.cards.bulkAdd([card(LUCHA, "review"), card(CHAGUAN, "new")]);
    expect(await checkSuggestions(db, ["绿茶", "茶馆", "不是词"], "hsk-2025")).toEqual(
      ok({ words: kept(CHAGUAN), dropped: 2 }),
    );
  });

  it("reports a storage failure", async () => {
    vi.spyOn(db.cards, "toArray").mockRejectedValueOnce(new Error("UnknownError"));
    expect(await checkSuggestions(db, ["绿茶"], "hsk-2025")).toMatchObject({
      ok: false,
      error: { kind: "storage" },
    });
  });
});

describe("interests storage", () => {
  const memory = (initial: string | null) => {
    const values = new Map<string, string>();
    if (initial !== null) values.set("openlinguo.interests", initial);
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
  };

  it("starts empty, then reads back what was saved", () => {
    const storage = memory(null);
    expect(loadInterests(() => storage)).toEqual(ok(NO_INTERESTS));
    const interests = { themes: ["cooking", "nature"], note: "J’aime le thé." } as const;
    expect(saveInterests(() => storage, { ...interests, themes: [...interests.themes] })).toEqual(
      ok(null),
    );
    expect(loadInterests(() => storage)).toEqual(ok(interests));
  });

  it("reports a value it cannot read instead of using it", () => {
    expect(loadInterests(() => memory("{"))).toMatchObject({ ok: false });
    expect(
      loadInterests(() => memory(JSON.stringify({ themes: ["politics"], note: "" }))),
    ).toMatchObject({ ok: false });
    expect(
      loadInterests(() => memory(JSON.stringify({ themes: [], note: "x".repeat(121) }))),
    ).toMatchObject({ ok: false });
  });

  it("reports a browser that refuses storage", () => {
    const refusing = () => {
      throw new Error("SecurityError");
    };
    expect(loadInterests(refusing)).toEqual({ ok: false, error: "Error: SecurityError" });
    expect(saveInterests(refusing, NO_INTERESTS)).toEqual({
      ok: false,
      error: "Error: SecurityError",
    });
  });
});

describe("learningBand", () => {
  const counts = (fresh: number) => ({ new: fresh, learning: 0, due: 0 });

  it("is the first band with new cards left, else the last", () => {
    expect(learningBand([counts(0), counts(4), counts(9)])).toBe(2);
    expect(learningBand([counts(3), counts(4)])).toBe(1);
    expect(learningBand([counts(0), counts(0)])).toBe(2);
  });
});
