import "fake-indexeddb/auto";
import { inMemoryDictionary, ok, type DictEntry } from "@openlinguo/core";
import { createZhPack, type UnknownSequence } from "@openlinguo/lang-zh";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database, type StoredEntry } from "./database.ts";
import { acceptEntry, type NewEntry } from "./lexicon.ts";
import { annotateText } from "./reader.ts";
import {
  commonWords,
  currentMeasure,
  fromCache,
  fromExtendedLexicon,
  fromNameSignal,
  listUnknownWords,
  resolveUnknownWords,
} from "./unknown-words.ts";

const SEEN = Date.UTC(2026, 9, 24);

const stored = (simplified: string, hsk2025: number | null): StoredEntry => ({
  id: `${simplified}\tx1`,
  simplified,
  reading: "x1",
  variants: [],
  glosses: [[], [], []],
  hsk2025,
  gf0025: null,
  lexicon: true,
  frequency: null,
});
const COMMON = ["他", "和", "在", "也", "是", "我", "很", "好", "说", "了"];
const OTHER = ["王", "小", "红", "拍", "学校"];
const entries: readonly StoredEntry[] = [
  ...COMMON.map((word) => stored(word, 1)),
  stored("拍", 4),
  stored("王", null),
  stored("小", 2),
  stored("红", null),
  stored("学校", 1),
];

const dictionary: readonly DictEntry[] = [...COMMON, ...OTHER].map((headword) => ({
  headword,
  variants: [],
  reading: "wo3",
  glosses: [],
  level: null,
}));
const reading = createZhPack({
  lookup: inMemoryDictionary(dictionary),
  lexicon: new Set(dictionary.map(({ headword }) => headword)),
  proficiency: "hsk-2025",
  decompositions: new Map(),
  strokesOf: () => Promise.resolve(ok(null)),
  wordsOfPinyin: () => Promise.resolve(ok([])),
}).features.textReading;
if (reading === null) throw new Error("the zh pack reads texts");

const sequence = (text: string, compositional = false): UnknownSequence => ({
  text,
  start: 0,
  end: text.length,
  compositional,
});

let db: Database;
let counter = 0;

beforeEach(async () => {
  counter += 1;
  db = openDatabase(`unknown-words-test-${String(counter)}`);
  await db.entries.bulkPut([...entries]);
});

const extendedRow = (simplified: string, reading: string, pos: string, glosses: string[]) => ({
  id: [simplified, simplified, reading, pos].join("\t"),
  file: "f",
  simplified,
  traditional: simplified,
  reading,
  pos,
  glosses,
});

describe("commonWords", () => {
  it("keeps the words of HSK levels 1 to 3, whatever the referential", async () => {
    expect(await commonWords(db, ["他", "小", "红", "拍", "王", "龘"])).toEqual(
      ok(new Set(["他", "小"])),
    );
  });
});

describe("fromCache", () => {
  it("gives back what an earlier check found, with its source and date, and the empty ones too", async () => {
    await db.resolutions.bulkAdd([
      {
        sequence: "王小红",
        source: "wikidata",
        found: [{ kind: "person", reading: null, gloss: "singer", provenance: null }],
        checkedAt: SEEN,
      },
      { sequence: "王小红", source: "ai", found: [], checkedAt: SEEN + 1 },
    ]);
    const cached = await fromCache(db, ["王小红", "袁家界拍"]);
    expect(cached).toEqual(
      ok(
        new Map([
          [
            "王小红",
            {
              proposals: [
                {
                  source: "wikidata",
                  kind: "person",
                  reading: null,
                  gloss: "singer",
                  provenance: null,
                },
              ],
              checks: [
                { source: "wikidata", checkedAt: SEEN, found: 1 },
                { source: "ai", checkedAt: SEEN + 1, found: 0 },
              ],
            },
          ],
        ]),
      ),
    );
  });
});

describe("fromExtendedLexicon", () => {
  it("proposes the words of the list with their reading and glosses, a proper name as a name", async () => {
    await db.extendedWords.bulkPut([
      extendedRow("热可可", "re4 ke3 ke3", "noun", ["hot cocoa", "chocolate drink"]),
      extendedRow("小明", "Xiao3 ming2", "name", ["John Doe"]),
    ]);
    const proposals = await fromExtendedLexicon(db, ["热可可", "小明", "王小红"]);
    expect(proposals).toEqual(
      ok(
        new Map([
          [
            "热可可",
            [
              {
                source: "extended-lexicon",
                kind: "word",
                reading: "re4 ke3 ke3",
                gloss: "hot cocoa; chocolate drink",
                provenance: null,
              },
            ],
          ],
          [
            "小明",
            [
              {
                source: "extended-lexicon",
                kind: "name",
                reading: "Xiao3 ming2",
                gloss: "John Doe",
                provenance: null,
              },
            ],
          ],
        ]),
      ),
    );
  });

  it("proposes nothing before the list is downloaded", async () => {
    expect(await fromExtendedLexicon(db, ["热可可"])).toEqual(ok(new Map()));
  });
});

describe("fromNameSignal", () => {
  it("proposes the kind jieba tags the sequence with, and no meaning", async () => {
    await db.names.bulkPut([
      { id: "王小红\tperson", file: "f", word: "王小红", kind: "person" },
      { id: "王小红\tplace", file: "f", word: "王小红", kind: "place" },
    ]);
    expect(await fromNameSignal(db, ["王小红", "李明"])).toEqual(
      ok(
        new Map([
          [
            "王小红",
            [
              {
                source: "name-signal",
                kind: "person",
                reading: null,
                gloss: null,
                provenance: null,
              },
              {
                source: "name-signal",
                kind: "place",
                reading: null,
                gloss: null,
                provenance: null,
              },
            ],
          ],
        ]),
      ),
    );
  });
});

describe("resolveUnknownWords", () => {
  it("lists the proposals in the order of the cascade, with the sentence around the sequence", async () => {
    await db.resolutions.add({
      sequence: "王小红",
      source: "wikidata",
      found: [{ kind: "person", reading: null, gloss: "singer", provenance: null }],
      checkedAt: SEEN,
    });
    await db.extendedWords.put(extendedRow("王小红", "wang2 xiao3 hong2", "name", ["a name"]));
    await db.names.put({ id: "王小红\tperson", file: "f", word: "王小红", kind: "person" });
    const resolved = await resolveUnknownWords(db, "你好。他和王小红在学校。", [
      { text: "王小红", start: 5, end: 8, compositional: false },
    ]);
    if (!resolved.ok) throw new Error(resolved.error.kind);
    expect(resolved.value).toHaveLength(1);
    const [word] = resolved.value;
    expect(word).toMatchObject({
      text: "王小红",
      before: "他和",
      after: "在学校。",
      compositional: false,
      wikidata: true,
      checks: [{ source: "wikidata", checkedAt: SEEN, found: 1 }],
    });
    expect(word?.proposals.map(({ source }) => source)).toEqual([
      "wikidata",
      "extended-lexicon",
      "name-signal",
    ]);
  });

  it("keeps a run of common words out of Wikidata, unless the extended lexicon has it", async () => {
    await db.extendedWords.put(extendedRow("我很好", "wo3 hen3 hao3", "phrase", ["I am fine"]));
    const resolved = await resolveUnknownWords(db, "我很好。他也是。", [
      { text: "我很好", start: 0, end: 3, compositional: true },
      { text: "他也是", start: 4, end: 7, compositional: true },
    ]);
    if (!resolved.ok) throw new Error(resolved.error.kind);
    expect(
      resolved.value.map(({ text, compositional, wikidata }) => [text, compositional, wikidata]),
    ).toEqual([
      ["我很好", false, true],
      ["他也是", true, false],
    ]);
  });

  it("keeps a sequence Wikidata cannot take out of Wikidata", async () => {
    const long = "龘".repeat(31);
    const resolved = await resolveUnknownWords(db, long, [sequence(long)]);
    expect(resolved.ok && resolved.value[0]?.wikidata).toBe(false);
  });
});

describe("currentMeasure", () => {
  it("counts a validated name as known once the text is split again", async () => {
    const text = { body: "他和王小红在学校。", readingChoices: {} };
    expect(await currentMeasure(db, reading, "zh", text)).toEqual(
      ok({ known: 0, total: 7, unknownWords: 7, unresolved: 0 }),
    );
    await acceptEntry(
      db,
      {
        headword: "王小红",
        kind: "person",
        reading: null,
        gloss: null,
        source: "learner",
        provenance: null,
      },
      SEEN,
    );
    expect(await currentMeasure(db, reading, "zh", text)).toEqual(
      ok({ known: 1, total: 5, unknownWords: 4, unresolved: 0 }),
    );
  });
});

describe("listUnknownWords", () => {
  const list = async (body: string) => {
    const tokens = await annotateText(db, reading, body);
    if (!tokens.ok) throw new Error(tokens.error.kind);
    const words = await listUnknownWords(db, body, tokens.value);
    if (!words.ok) throw new Error(words.error.kind);
    return words.value;
  };

  it("cuts the runs on HSK 1 to 3 words, and sets the runs of common words apart", async () => {
    const words = await list("他和王小红在学校。我很好。");
    expect(words.map(({ text, compositional }) => [text, compositional])).toEqual([
      ["王小红", false],
      ["我很好", true],
    ]);
  });

  it("segments the personal lexicon as words: the sequence is no longer unknown", async () => {
    const entry: NewEntry = {
      headword: "王小红",
      kind: "person",
      reading: null,
      gloss: null,
      source: "learner",
      provenance: null,
    };
    expect(await acceptEntry(db, entry, SEEN)).toEqual(ok(null));
    const words = await list("他和王小红在学校。");
    expect(words.filter(({ compositional }) => !compositional)).toEqual([]);
  });
});
