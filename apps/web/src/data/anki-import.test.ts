import "fake-indexeddb/auto";
import { openAsBlob } from "node:fs";
import { err, ok, type WordKey } from "@openlinguo/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  audioType,
  fieldText,
  freeSpace,
  guessMapping,
  importPlan,
  isQuotaShort,
  loadMapping,
  planImport,
  saveMappings,
  soundOf,
  type FieldMapping,
  type ImportPlan,
} from "./anki-import.ts";
import { readPackage, type AnkiNoteType, type AnkiPackage } from "./anki-package.ts";
import { deckWordId, openDatabase, type Database, type StoredEntry } from "./database.ts";
import { createDeck, deleteDeck, fileWord } from "./decks.ts";

const entry = (simplified: string, reading: string, variants: string[] = []): StoredEntry => ({
  id: `${simplified}\t${reading.toLowerCase()}`,
  simplified,
  reading,
  variants,
  glosses: [[], [], []],
  hsk2025: null,
  gf0025: null,
  lexicon: true,
  frequency: null,
});

const ENTRIES = [
  entry("你好", "ni3 hao3"),
  entry("谢谢", "xie4 xie5"),
  entry("电话", "dian4 hua4", ["電話"]),
  entry("了", "le5"),
  entry("了", "liao3"),
  entry("学习", "xue2 xi2"),
  entry("吃", "chi1"),
  entry("中文", "Zhong1 wen2"),
  entry("书", "shu1"),
  entry("一个", "yi1 ge4"),
  entry("行", "xing2"),
  entry("行", "hang2"),
];

const word = (headword: string, readingKey: string): WordKey => ({ headword, readingKey });

const memory = (): Pick<Storage, "getItem" | "setItem"> => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

const fixture = async (): Promise<AnkiPackage> => {
  const read = await readPackage(
    await openAsBlob(new URL("../../fixtures/anki/anki-26.09.3-latest.apkg", import.meta.url)),
  );
  if (!read.ok) throw new Error(read.error.kind);
  return read.value;
};

const guessed = (ankiPackage: AnkiPackage): Map<string, FieldMapping> =>
  new Map(
    ankiPackage.noteTypes.map((noteType) => [noteType.id, guessMapping(noteType, ankiPackage)]),
  );

const CHINESE: AnkiNoteType = { id: "1", name: "Chinese", fields: ["Hanzi", "Pinyin"] };

/** A package of Hanzi/Pinyin notes without media. */
const notesPackage = (notes: readonly (readonly [string, string])[]): AnkiPackage => ({
  deckName: null,
  noteTypes: [CHINESE],
  notes: notes.map((fields) => ({ noteTypeId: CHINESE.id, fields })),
  media: new Map(),
  read: () => Promise.resolve(err({ kind: "no-collection" })),
});

const HANZI_PINYIN = new Map([
  [CHINESE.id, { characters: 0, pinyin: 1, meaning: null, audio: null }],
]);

let db: Database;
let counter = 0;

beforeEach(async () => {
  counter += 1;
  db = openDatabase(`anki-import-test-${String(counter)}`);
  await db.entries.bulkPut(ENTRIES);
});

const planned = async (
  ankiPackage: AnkiPackage,
  mappings: Map<string, FieldMapping>,
): Promise<ImportPlan> => {
  const plan = await planImport(db, ankiPackage, mappings);
  if (!plan.ok) throw new Error(plan.error.kind);
  return plan.value;
};

describe("fieldText", () => {
  it("keeps the text only, without scripts, styles, sounds or entities", () => {
    expect(fieldText("<b>学习</b>&nbsp;")).toBe("学习");
    expect(fieldText("<script>alert(1)</script>吃<style>p{}</style>")).toBe("吃");
    expect(fieldText('<img src=x.png onerror="alert(1)">eat')).toBe("eat");
    expect(fieldText("nǐ<br>hǎo<div>[sound:a.mp3]</div>")).toBe("nǐ hǎo");
    expect(fieldText("&lt;b&gt; &#20320;&#x597D; &amp;c &bogus; &#xD800;")).toBe(
      "<b> 你好 &c &bogus; &#xD800;",
    );
    expect(fieldText("<SCRIPT>never closed")).toBe("");
    expect(fieldText("text <unclosed")).toBe("text");
  });
});

describe("soundOf", () => {
  it("reads the first sound's file name", () => {
    expect(soundOf("[sound:a&amp;b.mp3] [sound:c.mp3]")).toBe("a&b.mp3");
    expect(soundOf("no sound")).toBeNull();
  });
});

describe("audioType", () => {
  it("keeps audio extensions only", () => {
    expect(audioType("a.MP3")).toBe("audio/mpeg");
    expect(audioType("a.opus")).toBe("audio/ogg");
    expect(audioType("a.js")).toBeNull();
    expect(audioType("mp3")).toBeNull();
  });
});

describe("guessMapping", () => {
  it("finds the sound, characters, toned pinyin and meaning fields", async () => {
    const ankiPackage = await fixture();
    const [chinese, basic] = ankiPackage.noteTypes;
    if (chinese == null || basic == null) throw new Error("note types");
    expect(guessMapping(chinese, ankiPackage)).toEqual({
      characters: 0,
      pinyin: 1,
      meaning: 2,
      audio: 3,
    });
    expect(guessMapping(basic, ankiPackage)).toEqual({
      characters: 0,
      pinyin: null,
      meaning: 1,
      audio: null,
    });
  });
});

describe("loadMapping and saveMappings", () => {
  const mapping: FieldMapping = { characters: 0, pinyin: 1, meaning: null, audio: null };

  it("remembers a mapping by field names", () => {
    const storage = memory();
    expect(loadMapping(() => storage, CHINESE)).toEqual(ok(null));
    expect(saveMappings(() => storage, [CHINESE], new Map([[CHINESE.id, mapping]]))).toEqual(
      ok(null),
    );
    expect(loadMapping(() => storage, CHINESE)).toEqual(ok(mapping));
    const reordered = { ...CHINESE, fields: ["Notes", "Pinyin", "Hanzi"] };
    expect(loadMapping(() => storage, reordered)).toEqual(ok({ ...mapping, characters: 2 }));
  });

  it("forgets a mapping whose fields are gone, or a broken record", () => {
    const storage = memory();
    saveMappings(() => storage, [CHINESE], new Map([[CHINESE.id, mapping]]));
    expect(loadMapping(() => storage, { ...CHINESE, fields: ["Front", "Back"] })).toEqual(ok(null));
    storage.setItem("openlinguo.ankiFields", "{not json");
    expect(loadMapping(() => storage, CHINESE)).toEqual(ok(null));
  });

  it("fails when storage is unavailable", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    expect(loadMapping(blocked, CHINESE)).toEqual(err("Error: blocked"));
  });
});

describe("planImport", () => {
  it("matches notes to readings, attaches their audio and lists the rest", async () => {
    const ankiPackage = await fixture();
    const plan = await planned(ankiPackage, guessed(ankiPackage));
    expect(
      plan.words.map(({ headword, readingKey, audio }) => [
        headword,
        readingKey,
        audio?.name ?? null,
      ]),
    ).toEqual([
      ["你好", "ni3 hao3", "nihao.wav"],
      ["谢谢", "xie4 xie5", "xiexie.mp3"],
      ["电话", "dian4 hua4", "dianhua.mp3"],
      ["学习", "xue2 xi2", "xuexi.mp3"],
      ["吃", "chi1", null],
      ["中文", "zhong1 wen2", null],
      ["书", "shu1", null],
    ]);
    expect(plan.unmatched).toEqual([
      {
        characters: "了",
        pinyin: "",
        meaning: "particle",
        sound: null,
        reason: "several-readings",
      },
      {
        characters: "不存在词语",
        pinyin: "bù cún zài",
        meaning: "made up",
        sound: "fake.mp3",
        reason: "not-found",
      },
    ]);
    expect(plan.ignored).toBe(0);
    expect(plan.notAudio).toEqual(["chi.js"]);
    expect(plan.missingAudio).toEqual(["missing.mp3"]);
    expect(plan.audioBytes).toBe(
      plan.words.reduce((sum, planned) => sum + (planned.audio?.media.size ?? 0), 0),
    );
    expect(plan.audioBytes).toBeGreaterThan(1600);
  });

  it("chooses a reading by pinyin, toneless or with sandhi tones", async () => {
    const plan = await planned(
      notesPackage([
        ["了", "liǎo"],
        ["了", "le"],
        ["一个", "yí gè"],
        ["行", "háng"],
        ["你好", "ni hao ma"],
        ["行", "xíng háng"],
        ["你好", "nǐ hǎo"],
      ]),
      HANZI_PINYIN,
    );
    expect(plan.words.map(({ headword, readingKey }) => `${headword} ${readingKey}`)).toEqual([
      "了 liao3",
      "了 le5",
      "一个 yi1 ge4",
      "行 hang2",
      "你好 ni3 hao3",
    ]);
    expect(plan.unmatched.map((note) => note.reason)).toEqual(["pinyin-differs", "pinyin-differs"]);
  });

  it("leaves out note types without a characters field and empty notes", async () => {
    const plan = await planned(
      notesPackage([
        ["你好", ""],
        ["<br>", ""],
      ]),
      HANZI_PINYIN,
    );
    expect(plan.words).toHaveLength(1);
    expect(plan.ignored).toBe(1);
    const none = await planned(notesPackage([["你好", ""]]), new Map());
    expect(none.ignored).toBe(1);
  });
});

describe("importPlan", () => {
  const audioRows = () => db.audio.toArray();

  it("creates the deck with its readings' cards and audio", async () => {
    const ankiPackage = await fixture();
    const plan = await planned(ankiPackage, guessed(ankiPackage));
    expect(await importPlan(db, ankiPackage, plan, "  HSK test  ")).toEqual(
      ok({ name: "HSK test", words: 7, audio: 4 }),
    );
    const [deck] = await db.decks.toArray();
    if (deck == null) throw new Error("no deck");
    expect(deck.name).toBe("HSK test");
    expect(await db.deckWords.count()).toBe(7);
    expect(await db.cards.count()).toBe(14);
    const audio = await audioRows();
    expect(audio.map(({ id, type }) => [id, type])).toContainEqual([
      deckWordId(deck.id, word("你好", "ni3 hao3")),
      "audio/wav",
    ]);
    const wav = audio.find((row) => row.type === "audio/wav");
    expect(wav && [...new Uint8Array(wav.data).subarray(0, 4)]).toEqual([0x52, 0x49, 0x46, 0x46]);

    expect(await fileWord(db, deck.id, word("你好", "ni3 hao3"), false, "hsk-2025")).toEqual(
      ok(null),
    );
    expect(await db.audio.count()).toBe(3);
    expect(await deleteDeck(db, deck.id, "hsk-2025")).toEqual(ok(null));
    expect(await db.audio.count()).toBe(0);
  });

  it("writes nothing when the name is taken or the audio cannot be read", async () => {
    const ankiPackage = await fixture();
    const plan = await planned(ankiPackage, guessed(ankiPackage));
    await createDeck(db, "HSK test");
    expect(await importPlan(db, ankiPackage, plan, "hsk TEST")).toEqual(
      err({ kind: "deck-name", problem: "taken" }),
    );
    const broken = {
      ...ankiPackage,
      read: () => Promise.resolve(err({ kind: "no-collection" as const })),
    };
    expect(await importPlan(db, broken, plan, "Other")).toEqual(err({ kind: "no-collection" }));
    expect(await db.decks.count()).toBe(1);
    expect(await db.deckWords.count()).toBe(0);
    expect(await db.cards.count()).toBe(0);
    expect(await audioRows()).toEqual([]);
  });
});

describe("free space", () => {
  it("compares the audio size with the free space, when the browser tells it", async () => {
    expect(await freeSpace({ estimate: () => Promise.resolve({ quota: 100, usage: 30 }) })).toBe(
      70,
    );
    expect(await freeSpace({ estimate: () => Promise.resolve({}) })).toBeNull();
    expect(await freeSpace({ estimate: () => Promise.reject(new Error("no")) })).toBeNull();
    expect(await freeSpace(null)).toBeNull();
    const plan = { audioBytes: 80 } as const satisfies Pick<ImportPlan, "audioBytes">;
    expect(isQuotaShort(plan, 70)).toBe(true);
    expect(isQuotaShort(plan, 80)).toBe(false);
    expect(isQuotaShort(plan, null)).toBe(false);
  });
});
