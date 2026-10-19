import "fake-indexeddb/auto";
import type { WordKey } from "@openlinguo/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CHALLENGE_SENTENCES,
  listChallenges,
  loadChallenge,
  loadTodayChallenge,
  NO_CORRECTIONS,
  saveChallenge,
  type Challenge,
} from "./challenge.ts";
import type { SentenceCorrection } from "./correction.ts";
import { openDatabase, type Database, type StoredEntry } from "./database.ts";
import type { LocalTime } from "./decks.ts";
import { gradeItem, loadSession } from "./session.ts";

const entry = (simplified: string, readingKey: string, hsk2025: number): StoredEntry => ({
  id: `${simplified}\t${readingKey}`,
  simplified,
  reading: readingKey,
  variants: [],
  glosses: [[`${simplified} gloss`], [], []],
  hsk2025,
  gf0025: null,
  lexicon: true,
  frequency: 7,
});

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
// Paris summer, 12:00 on 2026-10-21.
const NOON: LocalTime = { at: Date.UTC(2026, 9, 21, 10), utcOffsetMinutes: 120 };
const at = (minutes: number): LocalTime => ({ ...NOON, at: NOON.at + minutes * MINUTE });
const TODAY = "2026-10-21";

const NI: WordKey = { headword: "你", readingKey: "ni3" };
const TIAN: WordKey = { headword: "天", readingKey: "tian1" };

let db: Database;
let counter = 0;

beforeEach(async () => {
  counter += 1;
  db = openDatabase(`challenge-test-${String(counter)}`);
  await db.entries.bulkAdd([entry("你", "ni3", 1), entry("天", "tian1", 2)]);
});

/** Grades the session's first card for `word` Good at `now`. */
const start = async (word: WordKey, now: LocalTime) => {
  const session = await loadSession(db, "hsk-2025", now, 20, { writing: false, typing: false });
  if (!session.ok) throw new Error(session.error.kind);
  const item = session.value.items.find(
    (candidate) => "headword" in candidate && candidate.headword === word.headword,
  );
  if (item == null) throw new Error(`${word.headword} is not in the session`);
  const graded = await gradeItem(db, item, "good", now, 20, false);
  if (!graded.ok) throw new Error(graded.error.kind);
};

const today = async (now: LocalTime) => {
  const loaded = await loadTodayChallenge(db, "hsk-2025", now);
  if (!loaded.ok) throw new Error(loaded.error.kind);
  return loaded.value;
};

const sentences = (...filled: readonly string[]): readonly string[] =>
  Array.from({ length: CHALLENGE_SENTENCES }, (_, index) => filled[index] ?? "");

describe("loadTodayChallenge", () => {
  it("has no challenge until a word is started on the learning day", async () => {
    expect(await today(NOON)).toBeNull();
  });

  it("takes the word started last today, with its entry and empty sentences", async () => {
    await start(NI, at(0));
    await start(TIAN, at(5));
    expect(await today(at(15))).toMatchObject({
      day: TODAY,
      word: { ...TIAN, entry: { headword: "天", reading: "tian1", level: 2 }, audio: null },
      sentences: sentences(),
    });
  });

  it("leaves out a word started on an earlier learning day, even with a card started today", async () => {
    await start(NI, at(-DAY / MINUTE));
    expect(await today(NOON)).toBeNull();
    await start(NI, NOON);
    expect(await today(at(1))).toBeNull();
  });

  it("rolls over at 4:00, not at midnight", async () => {
    // 2:00 on 2026-10-22 is still the learning day of 2026-10-21.
    await start(NI, at(14 * 60));
    expect(await today(at(15 * 60))).toMatchObject({ day: TODAY, word: NI });
    expect(await today(at(17 * 60))).toBeNull();
  });

  it("keeps the word of a challenge saved today", async () => {
    await start(NI, at(0));
    const challenge = await today(at(1));
    if (challenge === null) throw new Error("no challenge");
    await saveChallenge(db, { ...challenge, sentences: sentences("你好。") }, at(2).at);
    await start(TIAN, at(5));
    expect(await today(at(6))).toMatchObject({ word: NI, sentences: sentences("你好。") });
  });
});

describe("saveChallenge", () => {
  const challenge = (day: string, ...filled: readonly string[]): Challenge => ({
    day,
    word: { ...NI, entry: null, audio: null },
    sentences: sentences(...filled),
    corrections: NO_CORRECTIONS,
  });

  it("writes nothing while every field is empty", async () => {
    expect(await saveChallenge(db, challenge(TODAY, " "), NOON.at)).toEqual({
      ok: true,
      value: false,
    });
    expect(await db.challenges.count()).toBe(0);
  });

  it("keeps the sentences as typed, then lets them be emptied", async () => {
    expect(await saveChallenge(db, challenge(TODAY, "我是你。", "", "你好"), NOON.at)).toEqual({
      ok: true,
      value: true,
    });
    expect(await db.challenges.get(TODAY)).toEqual({
      day: TODAY,
      ...NI,
      sentences: sentences("我是你。", "", "你好"),
      corrections: NO_CORRECTIONS,
      updatedAt: NOON.at,
    });
    expect(await saveChallenge(db, challenge(TODAY), at(1).at)).toEqual({ ok: true, value: true });
    expect((await db.challenges.get(TODAY))?.sentences).toEqual(sentences());
  });

  it("keeps a correction while its field is the text corrected", async () => {
    const corrected: SentenceCorrection = {
      original: "我是你。",
      corrected: "我是你。",
      changes: [],
      reading: "wǒ shì nǐ .",
      meaning: "I am you.",
      choice: null,
      provenance: {
        origin: "ai",
        provider: "local",
        model: "qwen3:30b-a3b",
        promptVersion: "zh-correct-v1",
        createdAt: "2026-10-21T10:00:00.000Z",
      },
    };
    const corrections = [corrected, { ...corrected, original: "你好" }, null, null, null];
    await saveChallenge(db, { ...challenge(TODAY, "我是你。", "你好！"), corrections }, NOON.at);
    expect((await db.challenges.get(TODAY))?.corrections).toEqual([
      corrected,
      null,
      null,
      null,
      null,
    ]);
  });

  it("lists saved challenges, the latest day first, and loads a past one", async () => {
    await saveChallenge(db, challenge("2026-10-19", "你好。"), NOON.at);
    await saveChallenge(db, challenge(TODAY, "你们好。"), NOON.at);
    const listed = await listChallenges(db);
    expect(listed.ok && listed.value.map(({ day }) => day)).toEqual([TODAY, "2026-10-19"]);
    expect(await loadChallenge(db, "hsk-2025", "2026-10-19")).toMatchObject({
      ok: true,
      value: { day: "2026-10-19", word: { ...NI, entry: { headword: "你" } } },
    });
    expect(await loadChallenge(db, "hsk-2025", "2026-10-20")).toEqual({ ok: true, value: null });
  });

  it("keeps a challenge whose word left the dictionary", async () => {
    await db.challenges.put({
      day: TODAY,
      headword: "猫",
      readingKey: "mao1",
      sentences: sentences("猫。"),
      corrections: NO_CORRECTIONS,
      updatedAt: 1,
    });
    expect(await loadChallenge(db, "hsk-2025", TODAY)).toMatchObject({
      ok: true,
      value: { word: { headword: "猫", entry: null }, sentences: sentences("猫。") },
    });
  });
});
