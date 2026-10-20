import "fake-indexeddb/auto";
import { openAsBlob } from "node:fs";
import {
  cardId,
  CURRENT_SCHEDULER,
  err,
  ok,
  progress,
  Review,
  subjectOf,
  type WordKey,
} from "@openlinguo/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ankiGrade,
  audioBytes,
  audioType,
  cardHistory,
  fieldText,
  freeSpace,
  guessCards,
  guessMapping,
  historyReviews,
  importPlan,
  isQuotaShort,
  loadCards,
  loadMapping,
  planHistory,
  planImport,
  reviewId,
  saveMappings,
  shownFields,
  soundOf,
  type CardMapping,
  type FieldMapping,
  type ImportPlan,
} from "./anki-import.ts";
import {
  readPackage,
  type AnkiNoteType,
  type AnkiPackage,
  type AnkiReview,
} from "./anki-package.ts";
import { deckWordId, openDatabase, type Database, type StoredEntry } from "./database.ts";
import { createDeck, deleteDeck, fileWord, introduceWord } from "./decks.ts";
import { recordReview } from "./review-log.ts";

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

const fixture = async (name = "anki-26.09.3-latest.apkg"): Promise<AnkiPackage> => {
  const read = await readPackage(
    await openAsBlob(new URL(`../../fixtures/anki/${name}`, import.meta.url)),
  );
  if (!read.ok) throw new Error(read.error.kind);
  return read.value;
};

/** Reading ({{Hanzi}}) and Writing ({{Meaning}}) cards with answers; see fixtures/anki/README.md. */
const HISTORY = "anki-26.09.3-history-latest.apkg";

const guessed = (ankiPackage: AnkiPackage): Map<string, FieldMapping> =>
  new Map(
    ankiPackage.noteTypes.map((noteType) => [noteType.id, guessMapping(noteType, ankiPackage)]),
  );

const guessedCards = (ankiPackage: AnkiPackage): Map<string, CardMapping> =>
  new Map(
    ankiPackage.noteTypes.map((noteType) => [
      noteType.id,
      guessCards(noteType, guessMapping(noteType, ankiPackage)),
    ]),
  );

const CHINESE: AnkiNoteType = {
  id: "1",
  name: "Chinese",
  fields: ["Hanzi", "Pinyin"],
  templates: [{ name: "Card 1", front: "{{Hanzi}}" }],
};

/** A package of Hanzi/Pinyin notes without media. */
const notesPackage = (notes: readonly (readonly [string, string])[]): AnkiPackage => ({
  deckName: null,
  noteTypes: [CHINESE],
  notes: notes.map((fields, index) => ({
    id: String(index),
    guid: `g${String(index)}`,
    noteTypeId: CHINESE.id,
    fields,
  })),
  cards: [],
  reviews: [],
  v1Scheduler: false,
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
    expect(loadCards(blocked, CHINESE)).toEqual(err("Error: blocked"));
  });

  it("remembers the card mapping by template names, and keeps it when saved without", () => {
    const storage = memory();
    const reversed = {
      ...CHINESE,
      templates: [
        { name: "Reading", front: "{{Hanzi}}" },
        { name: "Writing", front: "{{Pinyin}}" },
      ],
    };
    const cards: CardMapping = { recognition: 0, recall: 1 };
    saveMappings(() => storage, [reversed], new Map([[reversed.id, mapping]]));
    expect(loadCards(() => storage, reversed)).toEqual(ok(null));
    saveMappings(
      () => storage,
      [reversed],
      new Map([[reversed.id, mapping]]),
      new Map([[reversed.id, cards]]),
    );
    expect(loadCards(() => storage, reversed)).toEqual(ok(cards));
    saveMappings(() => storage, [reversed], new Map([[reversed.id, mapping]]));
    expect(loadCards(() => storage, reversed)).toEqual(ok(cards));
    const reordered = { ...reversed, templates: reversed.templates.toReversed() };
    expect(loadCards(() => storage, reordered)).toEqual(ok({ recognition: 1, recall: 0 }));
    expect(loadCards(() => storage, { ...reversed, templates: [] })).toEqual(ok(null));
    expect(loadMapping(() => storage, reversed)).toEqual(ok(mapping));
  });
});

describe("shownFields and guessCards", () => {
  it("reads the fields a front shows, not those it asks to type or tests in a section", () => {
    expect([
      ...shownFields(
        "{{#Audio}}{{Audio}}{{/Audio}} {{text:Hanzi}} {{tts zh_CN:Pinyin}} {{type:Meaning}} {{^Notes}}{{!x}}",
      ),
    ]).toEqual(["Audio", "Hanzi", "Pinyin"]);
  });

  it("maps a template showing the characters to recognition and the meaning to recall", async () => {
    const history = await fixture(HISTORY);
    const [noteType] = history.noteTypes;
    if (noteType == null) throw new Error("no note type");
    const mapping = guessMapping(noteType, history);
    expect(mapping).toMatchObject({ characters: 0, meaning: 2 });
    expect(guessCards(noteType, mapping)).toEqual({ recognition: 0, recall: 1 });
    expect(guessCards(noteType, { ...mapping, meaning: null })).toEqual({
      recognition: 0,
      recall: null,
    });
    expect(guessCards(noteType, { ...mapping, characters: null })).toEqual({
      recognition: null,
      recall: 1,
    });
    expect(guessCards(CHINESE, { ...mapping, characters: 1 })).toEqual({
      recognition: null,
      recall: null,
    });
  });
});

const revlog = (
  entries: readonly (readonly [ease: number, type: number, factor?: number])[],
): AnkiReview[] =>
  entries.map(([ease, type, factor = 2500], index) => ({
    id: 1_000 + index,
    cardId: "c",
    ease,
    type,
    factor,
  }));

const grades = (log: readonly AnkiReview[], v1Scheduler = false) =>
  cardHistory(log, v1Scheduler).map((answer) => answer.grade);

describe("ankiGrade", () => {
  it("maps buttons 1 to 4, and the 3 buttons of v1 learning and relearning steps", () => {
    const buttons = [0, 1, 2, 3, 4, 5];
    const graded = (type: number, v1Scheduler: boolean) =>
      buttons.map((ease) => ankiGrade({ ease, type }, v1Scheduler));
    expect(graded(0, false)).toEqual([null, "again", "hard", "good", "easy", null]);
    expect(graded(0, true)).toEqual([null, "again", "good", "easy", "easy", null]);
    expect(graded(2, true)).toEqual([null, "again", "good", "easy", "easy", null]);
    expect(graded(1, true)).toEqual([null, "again", "hard", "good", "easy", null]);
    expect(graded(3, true)).toEqual([null, "again", "hard", "good", "easy", null]);
  });
});

describe("cardHistory", () => {
  it("keeps the answers, without manual entries, cramming or unknown kinds", () => {
    expect(
      grades(
        revlog([
          [1, 0],
          [3, 0],
          [0, 4],
          [0, 5],
          [2, 1],
          [1, 3, 0],
          [4, 3],
          [3, 9],
        ]),
      ),
    ).toEqual(["again", "good", "hard", "easy"]);
    expect(cardHistory(revlog([[3, 0]]).toReversed(), false)).toEqual([
      { at: 1_000, grade: "good" },
    ]);
  });

  it("starts at the last reset or at the last group of learning steps", () => {
    expect(
      grades(
        revlog([
          [3, 0],
          [3, 1],
          [0, 4, 0],
          [3, 0],
          [1, 3, 0],
          [3, 0],
          [4, 1],
        ]),
      ),
    ).toEqual(["good", "good", "easy"]);
    // Older Anki versions did not log a reset.
    expect(
      grades(
        revlog([
          [3, 0],
          [3, 1],
          [1, 2],
          [2, 0],
          [3, 1],
        ]),
      ),
    ).toEqual(["hard", "good"]);
    expect(
      grades(
        revlog([
          [3, 0],
          [3, 1],
          [0, 4, 0],
          [2, 1],
        ]),
      ),
    ).toEqual(["hard"]);
    expect(
      grades(
        revlog([
          [3, 0],
          [3, 1],
          [0, 4, 0],
        ]),
      ),
    ).toEqual([]);
    expect(
      grades(
        revlog([
          [0, 4],
          [3, 1],
          [2, 1],
        ]),
      ),
    ).toEqual(["good", "hard"]);
  });

  it("reads Anki's own logs, on the current and v1 schedulers", async () => {
    const logsOf = (ankiPackage: AnkiPackage) => {
      const notes = new Map(ankiPackage.notes.map((note) => [note.id, note.fields[0]]));
      return [
        ...Map.groupBy(ankiPackage.reviews, (review) => {
          const card = ankiPackage.cards.find((other) => other.id === review.cardId);
          return `${notes.get(card?.noteId ?? "") ?? ""} ${String(card?.ord)}`;
        }),
      ].map(([key, log]) => [key, grades(log, ankiPackage.v1Scheduler)]);
    };
    expect(logsOf(await fixture(HISTORY))).toEqual([
      ["你好 0", ["again", "good", "good", "good"]],
      ["你好 1", ["good", "good"]],
      ["谢谢 0", ["good", "good", "hard"]],
      ["学习 0", ["good"]],
      ["不存在词语 0", ["hard", "easy"]],
    ]);
    expect(logsOf(await fixture("anki-2.1.44-v1-history.apkg"))).toEqual([
      ["你好 0", ["again", "good", "good"]],
      ["谢谢 0", ["easy", "easy"]],
    ]);
  });
});

describe("planHistory", () => {
  it("gives each card the answers of the template mapped to its type", async () => {
    const history = await fixture(HISTORY);
    const plan = await planned(history, guessed(history));
    const cards = guessedCards(history);
    const answers = planHistory(history, [...plan.words, ...plan.notes], cards);
    const counts = [...Map.groupBy(answers, (answer) => answer.cardId)].map(([id, log]) => [
      id,
      log.map((answer) => answer.grade),
    ]);
    const [made] = plan.notes;
    expect(counts).toEqual([
      [
        cardId({ language: "zh", ...word("你好", "ni3 hao3"), type: "recognition" }),
        ["again", "good", "good", "good"],
      ],
      [cardId({ language: "zh", ...word("你好", "ni3 hao3"), type: "recall" }), ["good", "good"]],
      [
        cardId({ language: "zh", ...word("谢谢", "xie4 xie5"), type: "recognition" }),
        ["good", "good", "hard"],
      ],
      [cardId({ language: "zh", ...word("学习", "xue2 xi2"), type: "recognition" }), ["good"]],
      [cardId({ language: "zh", note: made?.note ?? "", type: "recognition" }), ["hard", "easy"]],
    ]);
    const recognitionOnly = new Map(
      [...cards].map(([id, mapping]) => [id, { ...mapping, recall: null }]),
    );
    const recall = new Set(
      plan.words.map((item) => cardId({ ...subjectOf(item), language: "zh", type: "recall" })),
    );
    const kept = planHistory(history, plan.words, recognitionOnly);
    expect(kept).toHaveLength(8);
    expect(kept.filter((answer) => recall.has(answer.cardId))).toEqual([]);
    expect(planHistory(history, plan.words, new Map())).toEqual([]);
  });

  it("takes the longest history among the notes of a reading, and the cloze template", async () => {
    const twice = {
      ...notesPackage([
        ["你好", "nǐ hǎo"],
        ["你好", "ni3 hao3"],
      ]),
      cards: [
        { id: "a", noteId: "0", ord: 0 },
        { id: "b", noteId: "1", ord: 2 },
      ],
      reviews: [
        { id: 1, cardId: "a", ease: 3, type: 0, factor: 0 },
        { id: 2, cardId: "b", ease: 1, type: 0, factor: 0 },
        { id: 3, cardId: "b", ease: 3, type: 0, factor: 0 },
      ],
    };
    const plan = await planned(twice, HANZI_PINYIN);
    expect(plan.words).toMatchObject([{ headword: "你好", noteIds: ["0", "1"] }]);
    expect(
      planHistory(twice, plan.words, new Map([[CHINESE.id, { recognition: 0, recall: null }]])),
    ).toEqual([
      {
        at: 2,
        grade: "again",
        cardId: cardId({ language: "zh", ...word("你好", "ni3 hao3"), type: "recognition" }),
      },
      {
        at: 3,
        grade: "good",
        cardId: cardId({ language: "zh", ...word("你好", "ni3 hao3"), type: "recognition" }),
      },
    ]);
  });
});

describe("reviewId and historyReviews", () => {
  it("derives a UUIDv8 from the answer time and the card", () => {
    const hash = new Uint8Array(32).fill(0xff);
    const id = reviewId(0x0123_4567_89ab, hash);
    expect(id).toBe("01234567-89ab-8fff-bfff-ffffffffffff");
    expect(reviewId(0, new Uint8Array(32))).toBe("00000000-0000-8000-8000-000000000000");
  });

  it("logs each answer with this device's offset and the current goal, always with the same id", async () => {
    const planned = [
      { cardId: "x", grade: "good" as const, at: 1_791_790_854_241 },
      { cardId: "y", grade: "again" as const, at: 1_791_790_854_241 },
    ];
    const reviews = await historyReviews(planned, 50, (at) => (at > 0 ? 120 : 0));
    expect(reviews.map((review) => Review.parse(review))).toEqual(reviews);
    expect(reviews).toMatchObject([
      {
        cardId: "x",
        grade: "good",
        reviewedAt: 1_791_790_854_241,
        utcOffsetMinutes: 120,
        scheduler: CURRENT_SCHEDULER,
        dailyGoal: 50,
        wordDone: null,
      },
      {
        cardId: "y",
        grade: "again",
        reviewedAt: 1_791_790_854_241,
        utcOffsetMinutes: 120,
        scheduler: CURRENT_SCHEDULER,
        dailyGoal: 50,
        wordDone: null,
      },
    ]);
    const [x, y] = reviews;
    expect(x?.id).not.toBe(y?.id);
    expect(x?.id.slice(0, 13)).toBe("01a12f0e-b061");
    expect((await historyReviews(planned, 20, () => 0)).map((review) => review.id)).toEqual(
      reviews.map((review) => review.id),
    );
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
    const guidOf = (characters: string) =>
      ankiPackage.notes.find((note) => note.fields[0] === characters)?.guid;
    expect(
      plan.notes.map(({ note, characters, pinyin, meaning, audio }) => [
        { note, characters, pinyin, meaning },
        audio?.name ?? null,
      ]),
    ).toEqual([
      [{ note: guidOf("了"), characters: "了", pinyin: "", meaning: "particle" }, null],
      [
        {
          note: guidOf("不存在词语"),
          characters: "不存在词语",
          pinyin: "bù cún zài",
          meaning: "made up",
        },
        "fake.mp3",
      ],
    ]);
    expect(plan.ignored).toBe(0);
    expect(plan.notAudio).toEqual(["chi.js"]);
    expect(plan.missingAudio).toEqual(["missing.mp3"]);
    expect(audioBytes(plan)).toBe(
      [...plan.words, ...plan.notes].reduce((sum, item) => sum + (item.audio?.media.size ?? 0), 0),
    );
    expect(audioBytes({ ...plan, notes: [] })).toBeGreaterThan(1600);
  });

  it("offers the unmatched notes with a meaning as cards of their own, once per guid", async () => {
    const note = (guid: string, fields: readonly string[]) => ({
      id: guid,
      guid,
      noteTypeId: CHINESE.id,
      fields,
    });
    const plan = await planned(
      {
        ...notesPackage([]),
        notes: [
          note("a", ["不存在", "bù cún zài", "<b>made</b> up"]),
          note("a", ["不存在", "bù", "again"]),
          note("b", ["无意", "wú yì", ""]),
          note("", ["无号", "", "no guid"]),
        ],
      },
      new Map([[CHINESE.id, { characters: 0, pinyin: 1, meaning: 2, audio: null }]]),
    );
    expect(plan.notes).toEqual([
      {
        note: "a",
        characters: "不存在",
        pinyin: "bù cún zài",
        meaning: "made up",
        audio: null,
        noteIds: ["a"],
      },
    ]);
    expect(plan.unmatched).toHaveLength(4);
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

  const review = (id: string) => ({
    id: crypto.randomUUID(),
    cardId: id,
    grade: "good" as const,
    reviewedAt: Date.now(),
    utcOffsetMinutes: 0,
    scheduler: CURRENT_SCHEDULER,
    dailyGoal: 20,
    wordDone: null,
  });

  it("creates the deck with the cards and audio of its readings and notes", async () => {
    const ankiPackage = await fixture();
    const plan = await planned(ankiPackage, guessed(ankiPackage));
    expect(await importPlan(db, ankiPackage, plan, "  HSK test  ")).toEqual(
      ok({ name: "HSK test", words: 7, notes: 2, audio: 5, reviews: 0 }),
    );
    const [deck] = await db.decks.toArray();
    if (deck == null) throw new Error("no deck");
    expect(deck.name).toBe("HSK test");
    expect(await db.deckWords.count()).toBe(9);
    expect(await db.cards.count()).toBe(18);
    const [, made] = plan.notes;
    if (made == null) throw new Error("no note");
    expect(await db.notes.get(made.note)).toEqual({
      id: made.note,
      characters: "不存在词语",
      pinyin: "bù cún zài",
      meaning: "made up",
      updatedAt: expect.any(Number) as number,
      provenance: null,
    });
    const audio = await audioRows();
    expect(audio.map(({ id, type }) => [id, type])).toEqual(
      expect.arrayContaining([
        [deckWordId(deck.id, word("你好", "ni3 hao3")), "audio/wav"],
        [deckWordId(deck.id, made), "audio/mpeg"],
      ]),
    );
    const wav = audio.find((row) => row.type === "audio/wav");
    expect(wav && [...new Uint8Array(wav.data).subarray(0, 4)]).toEqual([0x52, 0x49, 0x46, 0x46]);

    expect(await fileWord(db, deck.id, word("你好", "ni3 hao3"), false, "hsk-2025")).toEqual(
      ok(null),
    );
    expect(await db.audio.count()).toBe(4);
    const graded = await recordReview(
      db,
      review(cardId({ language: "zh", note: made.note, type: "recognition" })),
    );
    expect(graded.ok).toBe(true);
    expect(await deleteDeck(db, deck.id, "hsk-2025")).toEqual(ok(null));
    expect(await db.audio.count()).toBe(0);
    expect(await db.notes.count()).toBe(0);
    expect(await db.cards.count()).toBe(0);
    expect(await db.reviews.count()).toBe(1);
  });

  it("imports a note again as the same cards, with its new content", async () => {
    const ankiPackage = await fixture();
    const plan = await planned(ankiPackage, guessed(ankiPackage));
    await importPlan(db, ankiPackage, plan, "First");
    const [first] = await db.decks.toArray();
    if (first == null) throw new Error("no deck");
    const [particle] = plan.notes;
    if (particle == null) throw new Error("no note");
    const id = cardId({ language: "zh", note: particle.note, type: "recognition" });
    await recordReview(db, review(id));
    const changed = { ...plan, notes: plan.notes.map((note) => ({ ...note, meaning: "changed" })) };
    expect(await importPlan(db, ankiPackage, changed, "Second")).toMatchObject(ok({ notes: 2 }));
    expect(await db.cards.count()).toBe(18);
    expect((await db.cards.get(id))?.phase).not.toBe("new");
    expect((await db.notes.toArray()).map((note) => note.meaning)).toEqual(["changed", "changed"]);

    expect(await deleteDeck(db, first.id, "hsk-2025")).toEqual(ok(null));
    expect(await db.notes.count()).toBe(2);
    expect(await db.cards.count()).toBe(18);
  });

  it("logs the review history once, replaying the cards from the merged log", async () => {
    const history = await fixture(HISTORY);
    const plan = await planned(history, guessed(history));
    const answers = planHistory(history, [...plan.words, ...plan.notes], guessedCards(history));
    const reviews = await historyReviews(answers, 20, () => 120);
    const thanks = word("谢谢", "xie4 xie5");
    const recognition = cardId({ language: "zh", ...thanks, type: "recognition" });
    await introduceWord(db, thanks);
    await recordReview(db, review(recognition));

    expect(await importPlan(db, history, plan, "History", reviews)).toEqual(
      ok({ name: "History", words: 3, notes: 1, audio: 0, reviews: 12 }),
    );
    expect(await db.reviews.count()).toBe(13);
    const replayed = await db.cards.get(recognition);
    expect(replayed).toMatchObject({ phase: "review", reps: 4, firstReviewDay: "2026-10-12" });
    expect(
      await db.cards.get(cardId({ language: "zh", ...word("你好", "ni3 hao3"), type: "recall" })),
    ).toMatchObject({ reps: 2, lapses: 0 });
    const xp = progress(await db.reviews.toArray(), Date.now(), 120);
    expect(xp.ok && xp.value.totals.reviews).toBe(13);

    expect(await importPlan(db, history, plan, "Again", reviews)).toMatchObject(ok({ reviews: 0 }));
    expect(await db.reviews.count()).toBe(13);
    expect(await db.cards.get(recognition)).toEqual(replayed);
  });

  it("writes nothing when a review is not for a card of the deck", async () => {
    const history = await fixture(HISTORY);
    const plan = await planned(history, guessed(history));
    const [answer] = planHistory(history, plan.words, guessedCards(history));
    if (answer == null) throw new Error("no answer");
    const foreign = cardId({ language: "zh", ...word("书", "shu1"), type: "recall" });
    const reviews = await historyReviews([{ ...answer, cardId: foreign }], 20, () => 0);
    expect(await importPlan(db, history, plan, "History", reviews)).toEqual(
      err({ kind: "unknown-card", cardId: foreign }),
    );
    expect(await db.decks.count()).toBe(0);
    expect(await db.cards.count()).toBe(0);
    expect(await db.reviews.count()).toBe(0);
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
    expect(await db.notes.count()).toBe(0);
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
    const ankiPackage = await fixture();
    const plan = await planned(ankiPackage, guessed(ankiPackage));
    const bytes = audioBytes(plan);
    expect(isQuotaShort(plan, bytes - 1)).toBe(true);
    expect(isQuotaShort(plan, bytes)).toBe(false);
    expect(isQuotaShort(plan, null)).toBe(false);
  });
});
