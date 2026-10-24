import "fake-indexeddb/auto";
import {
  cardId,
  CURRENT_SCHEDULER,
  NEW_CARD_STATE,
  ok,
  replay,
  type Card,
  type CardKey,
  type CardState,
  type CardType,
  type Grade,
  type Review,
} from "@openlinguo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_AI_SETTINGS, saveAiSettings } from "./ai-settings.ts";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  exportBackup,
  importBackup,
  parseBackup,
  type Backup,
  type Settings,
} from "./backup.ts";
import {
  deckWordId,
  MY_WORDS,
  openDatabase,
  type Database,
  type StoredKnownMark,
  type StoredText,
} from "./database.ts";
import type { LexiconEntry } from "./lexicon.ts";
import type { Resolution } from "./resolutions.ts";

const DAY = 24 * 60 * 60_000;
const start = Date.UTC(2026, 9, 21, 6);
const now = new Date(start + 3 * DAY);

const card = (headword: string, readingKey: string, type: CardType): Card => {
  const key: CardKey = { language: "zh", headword, readingKey, type };
  return { ...key, id: cardId(key) };
};
const RECOGNITION = card("好", "hao3", "recognition");
const RECALL = card("好", "hao3", "recall");
const CAT = card("猫", "mao1", "recognition");
const NOTE_KEY: CardKey = { language: "zh", note: "Fx4k]?Lb!e", type: "recall" };
const NOTE_CARD: Card = { ...NOTE_KEY, id: cardId(NOTE_KEY) };
const NOTE = {
  id: "Fx4k]?Lb!e",
  characters: "不存在",
  pinyin: "bù cún zài",
  meaning: "made up",
  updatedAt: start,
  provenance: null,
};
const AI_NOTE = {
  id: "corrected-1",
  characters: "我的电话很新。",
  pinyin: "Wǒ de diànhuà hěn xīn.",
  meaning: "Mon téléphone est tout neuf.",
  updatedAt: start,
  provenance: {
    origin: "ai",
    provider: "groq",
    model: "openai/gpt-oss-120b",
    promptVersion: "zh-correct-v1",
    createdAt: "2026-10-19T14:03:27.512Z",
  },
} as const;

const CHALLENGE = {
  day: "2026-10-21",
  headword: "电话",
  readingKey: "dian4 hua4",
  sentences: ["我给妈妈打电话。", "", "请你电话我。", "", ""],
  corrections: [null, null, null, null, null],
  updatedAt: start,
};
const GLOSS = {
  headword: "一路平安",
  readingKey: "yi1 lu4 ping2 an1",
  senses: [
    { english: "to have a pleasant journey", french: "faire bon voyage" },
    { english: "Bon voyage!", french: "Bon voyage !" },
  ],
  provenance: { ...AI_NOTE.provenance, promptVersion: "zh-gloss-fr-v1" },
} as const;
const GLOSS_ID = "一路平安\tyi1 lu4 ping2 an1";

const CORRECTED = {
  ...CHALLENGE,
  day: "2026-10-23",
  corrections: [
    null,
    null,
    {
      original: "请你电话我。",
      corrected: "请你打电话给我。",
      changes: [{ from: "请你电话我", to: "请你打电话给我", explanation: "电话 is a noun." }],
      reading: "qǐng nǐ dǎ diàn huà gěi wǒ .",
      meaning: "Please call me.",
      choice: "accepted",
      provenance: AI_NOTE.provenance,
    },
    null,
    null,
  ],
} as const;

const ENTRY = {
  day: "2026-10-21",
  text: "我给妈妈打电话。 请你电话我。",
  corrections: [null, CORRECTED.corrections[2]],
  updatedAt: start,
};

const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const PASTED: StoredText = {
  id: uuid(200),
  title: "周末去张家界",
  body: "我去张家界玩了。",
  source: "paste",
  createdAt: start,
  provenance: null,
  readingChoices: { 4: "jia1" },
};
const STORY: StoredText = {
  id: uuid(201),
  title: "小花和大雨",
  body: "小花在家。外面下大雨。",
  source: "ai",
  createdAt: start + 1,
  provenance: { ...AI_NOTE.provenance, promptVersion: "zh-story-v1" },
  readingChoices: {},
};
const MARKS: StoredKnownMark[] = [
  { headword: "行", readingKey: "xing2", markedAt: start },
  { headword: "行", readingKey: "hang2", markedAt: start + 1 },
];

const NAME: LexiconEntry = {
  headword: "王小红",
  kind: "person",
  reading: "wang2 xiao3 hong2",
  gloss: null,
  source: "name-signal",
  provenance: null,
  validatedAt: start,
};
const ANSWER: Resolution = {
  sequence: "王小红",
  source: "wikidata",
  found: [{ kind: "person", reading: null, gloss: "chanteuse", provenance: null }],
  checkedAt: start,
};
const NOTHING: Resolution = { sequence: "袁家界拍", source: "ai", found: [], checkedAt: start };
const byHeadword = (a: LexiconEntry, b: LexiconEntry): number => (a.headword < b.headword ? -1 : 1);

const review = (n: number, cardId: string, reviewedAt: number, grade: Grade): Review => ({
  id: uuid(n),
  cardId,
  grade,
  reviewedAt,
  utcOffsetMinutes: 120,
  scheduler: CURRENT_SCHEDULER,
  dailyGoal: 20,
  wordDone: null,
});

const replayed = (id: string, log: readonly Review[]): CardState => {
  const state = replay(id, log);
  if (!state.ok) throw new Error(state.error.kind);
  return state.value;
};

const SETTINGS: Settings = {
  language: "fr",
  theme: "dark",
  referential: "gf0025-2021",
  dailyGoal: 50,
  newCardsPerDay: 0,
  showProgress: false,
  practiceTyping: false,
  practiceWriting: true,
  writeOnPaper: true,
  interests: { themes: ["cooking", "nature"], note: "J’aime le thé." },
};
const ANIMALS = { id: uuid(100), name: "Animals" };

const backup = (data: Partial<Backup>): Backup => ({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  exportedAt: now.toISOString(),
  settings: SETTINGS,
  cards: [],
  reviews: [],
  decks: [],
  deckWords: [],
  notes: [],
  challenges: [],
  aiGlosses: [],
  journal: [],
  texts: [],
  knownMarks: [],
  lexicon: [],
  resolutions: [],
  ...data,
});

let db: Database;
let counter = 0;

beforeEach(() => {
  counter += 1;
  db = openDatabase(`backup-test-${String(counter)}`);
});

describe("exportBackup", () => {
  it("exports cards without their state, the log, decks and settings, and parses back", async () => {
    const first = review(1, RECOGNITION.id, start, "good");
    await db.cards.bulkAdd([
      { ...RECOGNITION, ...replayed(RECOGNITION.id, [first]) },
      { ...RECALL, ...NEW_CARD_STATE },
      { ...NOTE_CARD, ...NEW_CARD_STATE },
    ]);
    await db.reviews.add(first);
    await db.decks.add(ANIMALS);
    await db.deckWords.bulkAdd([
      {
        id: deckWordId(ANIMALS.id, RECOGNITION),
        deckId: ANIMALS.id,
        headword: "好",
        readingKey: "hao3",
      },
      { id: deckWordId(ANIMALS.id, { note: NOTE.id }), deckId: ANIMALS.id, note: NOTE.id },
    ]);
    await db.notes.add(NOTE);

    const exported = await exportBackup(db, SETTINGS, now);
    const expected = backup({
      cards: [RECOGNITION, RECALL, NOTE_CARD].toSorted((a, b) => (a.id < b.id ? -1 : 1)),
      reviews: [first],
      decks: [ANIMALS],
      deckWords: [
        { deckId: ANIMALS.id, note: NOTE.id },
        { deckId: ANIMALS.id, headword: "好", readingKey: "hao3" },
      ],
      notes: [NOTE],
    });
    expect(exported).toEqual(ok(expected));
    expect(parseBackup(JSON.stringify(expected))).toEqual(ok(expected));
  });
});

describe("round trip", () => {
  it("keeps the provenance of AI notes", async () => {
    await db.notes.bulkAdd([NOTE, AI_NOTE]);
    const exported = await exportBackup(db, SETTINGS, now);
    if (!exported.ok) throw new Error(exported.error.kind);
    const parsed = parseBackup(JSON.stringify(exported.value));
    if (!parsed.ok) throw new Error(parsed.error.kind);
    const restored = openDatabase(`backup-test-restored-${String(counter)}`);
    expect(await importBackup(restored, parsed.value)).toMatchObject(ok({ notes: 2 }));
    expect(await restored.notes.toArray()).toEqual([NOTE, AI_NOTE]);
  });

  it("brings challenges back, the latest content of a day winning", async () => {
    await db.challenges.bulkAdd([CHALLENGE, { ...CHALLENGE, day: "2026-10-22" }, CORRECTED]);
    const exported = await exportBackup(db, SETTINGS, now);
    if (!exported.ok) throw new Error(exported.error.kind);
    const parsed = parseBackup(JSON.stringify(exported.value));
    if (!parsed.ok) throw new Error(parsed.error.kind);
    const restored = openDatabase(`backup-test-restored-${String(counter)}`);
    const newer = { ...CHALLENGE, sentences: ["我打电话。", "", "", "", ""], updatedAt: start + 1 };
    await restored.challenges.add(newer);
    expect(await importBackup(restored, parsed.value)).toMatchObject(ok({ challenges: 2 }));
    expect(await restored.challenges.toArray()).toEqual([
      newer,
      { ...CHALLENGE, day: "2026-10-22" },
      CORRECTED,
    ]);
  });

  it("brings journal entries back with their corrections, the latest content of a day winning", async () => {
    await db.journal.bulkAdd([ENTRY, { ...ENTRY, day: "2026-10-22", corrections: [null, null] }]);
    const exported = await exportBackup(db, SETTINGS, now);
    if (!exported.ok) throw new Error(exported.error.kind);
    const parsed = parseBackup(JSON.stringify(exported.value));
    if (!parsed.ok) throw new Error(parsed.error.kind);
    const restored = openDatabase(`backup-test-restored-${String(counter)}`);
    const newer = { ...ENTRY, day: "2026-10-22", text: "我打电话。", updatedAt: start + 1 };
    await restored.journal.add(newer);
    expect(await importBackup(restored, parsed.value)).toMatchObject(ok({ journal: 1 }));
    expect(await restored.journal.toArray()).toEqual([ENTRY, newer]);
  });

  it("brings texts back with their provenance and chosen readings, and the known marks", async () => {
    await db.texts.bulkAdd([PASTED, STORY]);
    await db.knownMarks.bulkAdd(MARKS);
    const exported = await exportBackup(db, SETTINGS, now);
    if (!exported.ok) throw new Error(exported.error.kind);
    expect(exported.value.texts).toEqual([PASTED, STORY]);
    expect(exported.value.knownMarks).toEqual(
      MARKS.toSorted((a, b) => (a.readingKey < b.readingKey ? -1 : 1)),
    );
    const parsed = parseBackup(JSON.stringify(exported.value));
    if (!parsed.ok) throw new Error(parsed.error.kind);
    const restored = openDatabase(`backup-test-restored-${String(counter)}`);
    expect(await importBackup(restored, parsed.value)).toMatchObject(ok({ texts: 2, marks: 2 }));
    expect(await restored.texts.orderBy("createdAt").toArray()).toEqual([PASTED, STORY]);
    expect(await restored.knownMarks.count()).toBe(2);
    expect(await importBackup(restored, parsed.value)).toMatchObject(ok({ texts: 0, marks: 0 }));
  });

  it("brings the personal lexicon and the kept answers back, the latest of each", async () => {
    const AI_ENTRY = {
      ...NAME,
      headword: "李明",
      source: "ai" as const,
      provenance: AI_NOTE.provenance,
    };
    await db.lexicon.bulkAdd([NAME, AI_ENTRY]);
    await db.resolutions.bulkAdd([ANSWER, NOTHING]);
    const exported = await exportBackup(db, SETTINGS, now);
    if (!exported.ok) throw new Error(exported.error.kind);
    expect(exported.value.lexicon).toEqual([AI_ENTRY, NAME].toSorted(byHeadword));
    expect(exported.value.resolutions).toHaveLength(2);
    const parsed = parseBackup(JSON.stringify(exported.value));
    if (!parsed.ok) throw new Error(parsed.error.kind);

    const restored = openDatabase(`backup-test-restored-${String(counter)}`);
    await restored.lexicon.add({ ...NAME, gloss: "newer", validatedAt: NAME.validatedAt + 1 });
    await restored.resolutions.add({ ...ANSWER, found: [], checkedAt: ANSWER.checkedAt - 1 });
    expect(await importBackup(restored, parsed.value)).toMatchObject(
      ok({ lexicon: 1, resolutions: 2 }),
    );
    expect(await restored.lexicon.get("王小红")).toMatchObject({ gloss: "newer" });
    expect(await restored.lexicon.get("李明")).toEqual(AI_ENTRY);
    expect(await restored.resolutions.get(["王小红", "wikidata"])).toEqual(ANSWER);
    expect(await importBackup(restored, parsed.value)).toMatchObject(
      ok({ lexicon: 0, resolutions: 0 }),
    );
  });

  it("keeps the local text when the same one is in the backup", async () => {
    const chosen = { ...PASTED, readingChoices: { 4: "jia1", 7: "le5" } };
    await db.texts.add(PASTED);
    const exported = await exportBackup(db, SETTINGS, now);
    if (!exported.ok) throw new Error(exported.error.kind);
    const restored = openDatabase(`backup-test-restored-${String(counter)}`);
    await restored.texts.add(chosen);
    expect(await importBackup(restored, exported.value)).toMatchObject(ok({ texts: 0 }));
    expect(await restored.texts.toArray()).toEqual([chosen]);
  });

  it("keeps the AI glosses with their provenance", async () => {
    await db.aiGlosses.add({ ...GLOSS, id: GLOSS_ID });
    const exported = await exportBackup(db, SETTINGS, now);
    if (!exported.ok) throw new Error(exported.error.kind);
    expect(exported.value.aiGlosses).toEqual([GLOSS]);
    const parsed = parseBackup(JSON.stringify(exported.value));
    if (!parsed.ok) throw new Error(parsed.error.kind);
    const restored = openDatabase(`backup-test-restored-${String(counter)}`);
    expect(await importBackup(restored, parsed.value)).toMatchObject(ok({ glosses: 1 }));
    expect(await restored.aiGlosses.toArray()).toEqual([{ ...GLOSS, id: GLOSS_ID }]);
  });

  it("brings writing and typing cards back with their states", async () => {
    const writing = card("好", "hao3", "writing");
    const typing = card("好", "hao3", "typing");
    const log = [
      review(1, writing.id, start, "hard"),
      review(2, typing.id, start + DAY, "good"),
      review(3, typing.id, start + 2 * DAY, "again"),
    ];
    const states = [
      { ...writing, ...replayed(writing.id, log.slice(0, 1)) },
      { ...typing, ...replayed(typing.id, log.slice(1)) },
    ];
    await db.cards.bulkAdd(states);
    await db.reviews.bulkAdd(log);
    const exported = await exportBackup(db, SETTINGS, now);
    if (!exported.ok) throw new Error(exported.error.kind);
    const parsed = parseBackup(JSON.stringify(exported.value));
    if (!parsed.ok) throw new Error(parsed.error.kind);

    const restored = openDatabase(`backup-test-${String(counter)}-restored`);
    expect(await importBackup(restored, parsed.value)).toEqual(
      ok({
        reviews: 3,
        cards: 2,
        decks: 0,
        words: 0,
        notes: 0,
        challenges: 0,
        glosses: 0,
        journal: 0,
        texts: 0,
        marks: 0,
        lexicon: 0,
        resolutions: 0,
      }),
    );
    expect(await restored.cards.toArray()).toEqual(
      states.toSorted((a, b) => (a.id < b.id ? -1 : 1)),
    );
  });
});

describe("parseBackup", () => {
  it("names a file that is not JSON, not a backup or from a newer version", () => {
    expect(parseBackup("{")).toMatchObject({ ok: false, error: { kind: "not-json" } });
    expect(parseBackup("[]")).toEqual({ ok: false, error: { kind: "not-backup" } });
    expect(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 2 }))).toEqual({
      ok: false,
      error: { kind: "newer-version", version: 2 },
    });
  });

  it("leaves out the AI settings and key", async () => {
    const key = { provider: "groq", value: "gsk_backup-test-key" } as const;
    await saveAiSettings(db, { ...DEFAULT_AI_SETTINGS, provider: "groq", key });
    const exported = await exportBackup(db, SETTINGS, now);
    if (!exported.ok) throw new Error(exported.error.kind);
    const text = JSON.stringify(exported.value);
    expect(text).not.toContain(key.value);
    expect(text).not.toContain("groq");
  });

  it("gives settings and review goals missing from an older backup their fallback", () => {
    const older = { language: "fr", theme: "dark", referential: "gf0025-2021" };
    const unstamped = { ...review(1, RECALL.id, start, "good") };
    Reflect.deleteProperty(unstamped, "dailyGoal");
    Reflect.deleteProperty(unstamped, "wordDone");
    const withoutNotes = { ...backup({}), settings: older, reviews: [unstamped] };
    Reflect.deleteProperty(withoutNotes, "notes");
    Reflect.deleteProperty(withoutNotes, "challenges");
    expect(parseBackup(JSON.stringify(withoutNotes))).toEqual(
      ok(
        backup({
          settings: {
            ...SETTINGS,
            dailyGoal: 20,
            newCardsPerDay: 20,
            showProgress: true,
            practiceTyping: true,
            practiceWriting: false,
            writeOnPaper: false,
            interests: null,
          },
          reviews: [review(1, RECALL.id, start, "good")],
        }),
      ),
    );
  });

  it("refuses interests the form could not have saved", () => {
    const interests = { themes: ["politics"], note: "x".repeat(121) };
    const parsed = parseBackup(
      JSON.stringify({ ...backup({}), settings: { ...SETTINGS, interests } }),
    );
    expect(parsed.ok ? [] : parsed.error.kind === "invalid" ? parsed.error.issues : []).toEqual([
      expect.objectContaining({ path: "settings.interests.themes.0" }),
      expect.objectContaining({ path: "settings.interests.note" }),
    ]);
  });

  it("reads notes of a backup made before M5 as written by the learner", () => {
    const preM5 = { ...NOTE };
    Reflect.deleteProperty(preM5, "provenance");
    expect(parseBackup(JSON.stringify(backup({ notes: [preM5] })))).toEqual(
      ok(backup({ notes: [NOTE] })),
    );
  });

  it("refuses two challenges on one day, or a challenge without its five fields", () => {
    expect(
      parseBackup(JSON.stringify(backup({ challenges: [CHALLENGE, CHALLENGE] }))),
    ).toMatchObject({ ok: false, error: { issues: [{ path: "challenges.1.day" }] } });
    expect(
      parseBackup(JSON.stringify(backup({ challenges: [{ ...CHALLENGE, sentences: ["好"] }] }))),
    ).toMatchObject({ ok: false, error: { issues: [{ path: "challenges.0.sentences" }] } });
  });

  it("refuses two journal entries on one day", () => {
    expect(parseBackup(JSON.stringify(backup({ journal: [ENTRY, ENTRY] })))).toMatchObject({
      ok: false,
      error: { issues: [{ path: "journal.1.day" }] },
    });
  });

  it("reads a backup made before the journal as having no entries", () => {
    const before = backup({});
    Reflect.deleteProperty(before, "journal");
    expect(parseBackup(JSON.stringify(before))).toEqual(ok(backup({})));
  });

  it("reads a backup made before the library as having no texts and no known marks", () => {
    const before = backup({});
    Reflect.deleteProperty(before, "texts");
    Reflect.deleteProperty(before, "knownMarks");
    expect(parseBackup(JSON.stringify(before))).toEqual(ok(backup({})));
  });

  it("reads a backup made before the unknown-words panel as having no lexicon and no answers", () => {
    const before = backup({});
    Reflect.deleteProperty(before, "lexicon");
    Reflect.deleteProperty(before, "resolutions");
    expect(parseBackup(JSON.stringify(before))).toEqual(ok(backup({})));
  });

  it("refuses a headword twice, and a source's answer twice", () => {
    expect(parseBackup(JSON.stringify(backup({ lexicon: [NAME, NAME] })))).toMatchObject({
      ok: false,
      error: { issues: [{ path: "lexicon.1.headword" }] },
    });
    expect(parseBackup(JSON.stringify(backup({ resolutions: [ANSWER, ANSWER] })))).toMatchObject({
      ok: false,
      error: { issues: [{ path: "resolutions.1" }] },
    });
  });

  it("refuses two texts with one id, and two marks of one reading", () => {
    expect(parseBackup(JSON.stringify(backup({ texts: [PASTED, PASTED] })))).toMatchObject({
      ok: false,
      error: { issues: [{ path: "texts.1.id" }] },
    });
    expect(parseBackup(JSON.stringify(backup({ knownMarks: [...MARKS, ...MARKS] })))).toMatchObject(
      {
        ok: false,
        error: { issues: [{ path: "knownMarks.2" }, { path: "knownMarks.3" }] },
      },
    );
  });

  it("refuses a story without provenance, and provenance on a text that is not a story", () => {
    const raw = (text: object): string => JSON.stringify({ ...backup({}), texts: [text] });
    expect(parseBackup(raw({ ...STORY, provenance: null }))).toMatchObject({ ok: false });
    expect(parseBackup(raw({ ...PASTED, provenance: STORY.provenance }))).toMatchObject({
      ok: false,
    });
  });

  it("accepts a text longer than today's limit, which the benchmark may lower", () => {
    const long = { ...PASTED, body: "好".repeat(25_000) };
    expect(parseBackup(JSON.stringify(backup({ texts: [long] }))).ok).toBe(true);
  });

  it("reads a backup made before M5 as having no AI glosses", () => {
    const preM5 = backup({});
    Reflect.deleteProperty(preM5, "aiGlosses");
    expect(parseBackup(JSON.stringify(preM5))).toEqual(ok(backup({})));
  });

  it("reads challenges of a backup made before corrections as uncorrected", () => {
    const before = { ...CHALLENGE };
    Reflect.deleteProperty(before, "corrections");
    expect(parseBackup(JSON.stringify(backup({ challenges: [before] })))).toEqual(
      ok(backup({ challenges: [CHALLENGE] })),
    );
  });

  it("lists each failing path", () => {
    const valid = backup({ decks: [ANIMALS] });
    const parsed = parseBackup(
      JSON.stringify({
        ...valid,
        reviews: [{ ...review(1, RECALL.id, start, "good"), grade: "perfect" }],
        cards: [{ ...RECALL, type: "recognition" }],
      }),
    );
    expect(parsed).toMatchObject({
      ok: false,
      error: { kind: "invalid", issues: [{ path: "cards.0.id" }, { path: "reviews.0.grade" }] },
    });
  });

  it("refuses duplicate ids, deck names taken and words filed in a missing deck", () => {
    const first = review(1, RECALL.id, start, "good");
    const parsed = parseBackup(
      JSON.stringify(
        backup({
          reviews: [first, first],
          decks: [ANIMALS, { id: uuid(101), name: " animals " }],
          deckWords: [{ deckId: uuid(102), headword: "猫", readingKey: "mao1" }],
          notes: [NOTE, NOTE],
          aiGlosses: [GLOSS, GLOSS],
        }),
      ),
    );
    expect(parsed).toMatchObject({
      ok: false,
      error: {
        kind: "invalid",
        issues: [
          { path: "reviews.1.id" },
          { path: "decks.1.name" },
          { path: "notes.1.id" },
          { path: "aiGlosses.1" },
          { path: "deckWords.0.deckId" },
        ],
      },
    });
  });
});

describe("importBackup", () => {
  it("replays every card from the merged log and keeps reviews of removed cards", async () => {
    const local = review(1, RECOGNITION.id, start, "good");
    await db.cards.add({ ...RECOGNITION, ...replayed(RECOGNITION.id, [local]) });
    await db.reviews.add(local);
    const lapse = review(2, RECOGNITION.id, start + 2 * DAY, "again");
    const recall = review(3, RECALL.id, start + DAY, "hard");
    const removed = review(4, "removed", start, "easy");

    expect(
      await importBackup(db, backup({ cards: [RECALL], reviews: [local, lapse, recall, removed] })),
    ).toEqual(
      ok({
        reviews: 3,
        cards: 1,
        decks: 0,
        words: 0,
        notes: 0,
        challenges: 0,
        glosses: 0,
        journal: 0,
        texts: 0,
        marks: 0,
        lexicon: 0,
        resolutions: 0,
      }),
    );
    expect(await db.cards.get(RECOGNITION.id)).toEqual({
      ...RECOGNITION,
      ...replayed(RECOGNITION.id, [local, lapse]),
    });
    expect(await db.cards.get(RECALL.id)).toEqual({ ...RECALL, ...replayed(RECALL.id, [recall]) });
    expect(await db.cards.count()).toBe(2);
    expect(await db.reviews.count()).toBe(4);
  });

  it("files words in my words and new decks, and changes nothing the second time", async () => {
    const data = backup({
      cards: [CAT],
      decks: [ANIMALS],
      deckWords: [
        { deckId: MY_WORDS, headword: "猫", readingKey: "mao1" },
        { deckId: ANIMALS.id, headword: "猫", readingKey: "mao1" },
      ],
    });
    expect(await importBackup(db, data)).toEqual(
      ok({
        reviews: 0,
        cards: 1,
        decks: 1,
        words: 2,
        notes: 0,
        challenges: 0,
        glosses: 0,
        journal: 0,
        texts: 0,
        marks: 0,
        lexicon: 0,
        resolutions: 0,
      }),
    );
    expect(await importBackup(db, data)).toEqual(
      ok({
        reviews: 0,
        cards: 0,
        decks: 0,
        words: 0,
        notes: 0,
        challenges: 0,
        glosses: 0,
        journal: 0,
        texts: 0,
        marks: 0,
        lexicon: 0,
        resolutions: 0,
      }),
    );
    expect(await db.decks.toArray()).toEqual([ANIMALS]);
    expect((await db.deckWords.toArray()).map((word) => word.id).toSorted()).toEqual(
      [deckWordId(ANIMALS.id, CAT), deckWordId(MY_WORDS, CAT)].toSorted(),
    );
  });

  it("keeps local deck names and merges an imported deck into the local one of the same name", async () => {
    await db.decks.bulkAdd([
      { id: ANIMALS.id, name: "Zoo" },
      { id: uuid(101), name: "Food" },
    ]);
    const data = backup({
      decks: [ANIMALS, { id: uuid(102), name: "food" }],
      deckWords: [
        { deckId: ANIMALS.id, headword: "猫", readingKey: "mao1" },
        { deckId: uuid(102), headword: "好", readingKey: "hao3" },
      ],
    });
    expect(await importBackup(db, data)).toEqual(
      ok({
        reviews: 0,
        cards: 0,
        decks: 0,
        words: 2,
        notes: 0,
        challenges: 0,
        glosses: 0,
        journal: 0,
        texts: 0,
        marks: 0,
        lexicon: 0,
        resolutions: 0,
      }),
    );
    expect(await db.decks.toArray()).toEqual([
      { id: ANIMALS.id, name: "Zoo" },
      { id: uuid(101), name: "Food" },
    ]);
    expect(await db.deckWords.get(deckWordId(uuid(101), RECOGNITION))).toMatchObject({
      deckId: uuid(101),
    });
  });

  it("files notes and keeps the latest content of each, the second time too", async () => {
    const older = { ...NOTE, id: "older", meaning: "old" };
    await db.notes.bulkAdd([
      { ...NOTE, meaning: "local", updatedAt: start + DAY },
      { ...older, updatedAt: start - DAY },
    ]);
    const data = backup({
      cards: [NOTE_CARD],
      deckWords: [{ deckId: MY_WORDS, note: NOTE.id }],
      notes: [NOTE, { ...older, meaning: "imported" }, { ...NOTE, id: "new" }],
    });
    expect(await importBackup(db, data)).toEqual(
      ok({
        reviews: 0,
        cards: 1,
        decks: 0,
        words: 1,
        notes: 2,
        challenges: 0,
        glosses: 0,
        journal: 0,
        texts: 0,
        marks: 0,
        lexicon: 0,
        resolutions: 0,
      }),
    );
    expect(await importBackup(db, data)).toEqual(
      ok({
        reviews: 0,
        cards: 0,
        decks: 0,
        words: 0,
        notes: 0,
        challenges: 0,
        glosses: 0,
        journal: 0,
        texts: 0,
        marks: 0,
        lexicon: 0,
        resolutions: 0,
      }),
    );
    expect((await db.notes.toArray()).map(({ id, meaning }) => [id, meaning])).toEqual([
      [NOTE.id, "local"],
      ["new", "made up"],
      ["older", "imported"],
    ]);
    expect(await db.deckWords.get(deckWordId(MY_WORDS, { note: NOTE.id }))).toEqual({
      id: deckWordId(MY_WORDS, { note: NOTE.id }),
      deckId: MY_WORDS,
      note: NOTE.id,
    });
  });

  it("keeps the latest translation of each word, the second time too", async () => {
    const later = { ...GLOSS.provenance, createdAt: "2026-10-20T08:00:00.000Z" };
    const other = { ...GLOSS, headword: "一路顺风", readingKey: "yi1 lu4 shun4 feng1" };
    await db.aiGlosses.add({ ...GLOSS, id: GLOSS_ID, provenance: later });
    const data = backup({ aiGlosses: [GLOSS, other] });
    expect(await importBackup(db, data)).toMatchObject(ok({ glosses: 1 }));
    expect(await importBackup(db, data)).toMatchObject(ok({ glosses: 0 }));
    expect((await db.aiGlosses.toArray()).map(({ id, provenance }) => [id, provenance])).toEqual([
      [GLOSS_ID, later],
      ["一路顺风\tyi1 lu4 shun4 feng1", GLOSS.provenance],
    ]);
  });

  it("writes nothing when the merged log cannot be replayed", async () => {
    await db.cards.add({ ...RECALL, ...NEW_CARD_STATE });
    await db
      .table("reviews")
      .add({ ...review(1, RECALL.id, start, "good"), scheduler: "fsrs7-v1" });
    const data = backup({
      cards: [CAT],
      reviews: [review(2, CAT.id, start, "good")],
      decks: [ANIMALS],
    });
    expect(await importBackup(db, data)).toMatchObject({
      ok: false,
      error: { kind: "scheduler-failure" },
    });
    expect(await db.cards.toArray()).toEqual([{ ...RECALL, ...NEW_CARD_STATE }]);
    expect(await db.reviews.count()).toBe(1);
    expect(await db.decks.count()).toBe(0);
  });
});
