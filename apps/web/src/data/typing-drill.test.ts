import "fake-indexeddb/auto";
import { NEW_CARD_STATE, newCards, type CardType, type WordKey } from "@openlinguo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { wordAudioId } from "./audio-packs.ts";
import { openDatabase, type Database, type StoredEntry } from "./database.ts";
import {
  answer,
  charactersPerMinute,
  currentWord,
  drawRound,
  endRound,
  loadDrillWords,
  roundResult,
  startRound,
  tick,
  timeLeft,
  withAudio,
  type EndedRound,
  type Round,
} from "./typing-drill.ts";

const MINUTE = 60_000;
const START = 1_000_000;

type Word = { readonly headword: string };

const word = (headword: string): Word => ({ headword });
const WORDS = [word("电话"), word("图书馆"), word("人")];

const ended = <W extends { readonly headword: string }>(round: Round<W>): EndedRound<W> => {
  if (round.endedAt === null) throw new Error("the round is still running");
  return round;
};

/** A source of "random" numbers that returns these, then 0. */
const sequence =
  (...values: number[]) =>
  () =>
    values.shift() ?? 0;

describe("drawRound", () => {
  it("draws up to the size, each word once, in the order drawn", () => {
    expect(drawRound(["a", "b", "c", "d"], 3, sequence(0.99, 0, 0.5))).toEqual(["d", "a", "c"]);
  });

  it("draws every word when there are fewer than the size", () => {
    expect(drawRound(["a", "b"], 10, Math.random).toSorted()).toEqual(["a", "b"]);
    expect(drawRound([], 10, Math.random)).toEqual([]);
  });

  it("stays in range when the source returns 1", () => {
    expect(drawRound(["a", "b"], 2, () => 1)).toEqual(["b", "a"]);
  });
});

describe("a round", () => {
  it("moves through the words and ends at the last answer", () => {
    let round: Round<Word> = startRound(WORDS, START, null);
    expect(currentWord(round)).toEqual(word("电话"));
    round = answer(round, "电话", START + 1000);
    expect(currentWord(round)).toEqual(word("图书馆"));
    round = answer(round, "图书", START + 2000);
    expect(round.endedAt).toBeNull();
    round = answer(round, "人", START + 3000);
    expect(round.endedAt).toBe(START + 3000);
    expect(currentWord(round)).toBeNull();
    expect(answer(round, "x", START + 4000)).toBe(round);
  });

  it("has no time limit when untimed", () => {
    const round = startRound(WORDS, START, null);
    expect(timeLeft(round, START + 60 * MINUTE)).toBeNull();
    expect(tick(round, START + 60 * MINUTE)).toBe(round);
  });

  it("counts down when timed and ends at its limit", () => {
    const round = startRound(WORDS, START, MINUTE);
    expect(timeLeft(round, START + 15_000)).toBe(45_000);
    expect(tick(round, START + 59_999)).toBe(round);
    const late = tick(round, START + 61_000);
    expect(late.endedAt).toBe(START + MINUTE);
    expect(timeLeft(late, START + 61_000)).toBe(0);
  });

  it("drops an answer given after the limit and ends there", () => {
    const round = answer(startRound(WORDS, START, MINUTE), "电话", START + MINUTE + 10);
    expect(round.typed).toEqual([]);
    expect(round.endedAt).toBe(START + MINUTE);
  });

  it("stops at once, at most at its limit, and only once", () => {
    const round = startRound(WORDS, START, MINUTE);
    const stopped = endRound(round, START + 5000);
    expect(stopped.endedAt).toBe(START + 5000);
    expect(endRound(stopped, START + 9000)).toBe(stopped);
    expect(endRound(round, START + 2 * MINUTE).endedAt).toBe(START + MINUTE);
  });
});

describe("roundResult", () => {
  it("counts the words typed exactly, and the characters of the right answers per minute", () => {
    let round: Round<Word> = startRound(WORDS, START, null);
    round = answer(round, "电话", START + 10_000);
    round = answer(round, "图书", START + 20_000);
    round = answer(round, "人", START + 30_000);
    expect(roundResult(ended(round))).toEqual({
      outcomes: [
        { word: word("电话"), typed: "电话", right: true },
        { word: word("图书馆"), typed: "图书", right: false },
        { word: word("人"), typed: "人", right: true },
      ],
      right: 2,
      characters: 3,
      elapsed: 30_000,
      perMinute: 6,
    });
  });

  it("counts the words not reached as missed", () => {
    const round = endRound(
      answer(startRound(WORDS, START, MINUTE), "电话", START + 5000),
      START + 7000,
    );
    const result = roundResult(ended(round));
    expect(result.outcomes.map(({ typed, right }) => [typed, right])).toEqual([
      ["电话", true],
      [null, false],
      [null, false],
    ]);
    expect(result.right).toBe(1);
    expect(result.elapsed).toBe(7000);
  });
});

describe("charactersPerMinute", () => {
  it.each([
    [17, 85_000, 12],
    [0, 30_000, 0],
    [5, MINUTE, 5],
    [3, 0, 0],
  ])("%d characters in %d ms: %d", (characters, elapsed, perMinute) => {
    expect(charactersPerMinute(characters, elapsed)).toBe(perMinute);
  });
});

const entry = (simplified: string, readingKey: string): StoredEntry => ({
  id: `${simplified}\t${readingKey}`,
  simplified,
  reading: readingKey,
  variants: [],
  glosses: [[`${simplified} gloss`], [], []],
  hsk2025: 1,
  gf0025: null,
  lexicon: true,
  frequency: 7,
});

const NI: WordKey = { headword: "你", readingKey: "ni3" };
const TIAN: WordKey = { headword: "天", readingKey: "tian1" };
const GONE: WordKey = { headword: "鹅", readingKey: "e2" };

const startCards = (word: WordKey, types: readonly CardType[]) =>
  db.cards.bulkPut(newCards("zh", word, types).map((card) => ({ ...card, ...NEW_CARD_STATE })));

let db: Database;
let counter = 0;

beforeEach(async () => {
  counter += 1;
  db = openDatabase(`typing-drill-test-${String(counter)}`);
  await db.entries.bulkAdd([entry("你", "ni3"), entry("天", "tian1")]);
});

describe("loadDrillWords", () => {
  it("lists each started word once, with its entry, leaving out those not in the dictionary", async () => {
    await startCards(NI, ["recognition", "recall"]);
    await startCards(GONE, ["recognition"]);
    await startCards(TIAN, ["typing"]);
    const loaded = await loadDrillWords(db, "hsk-2025");
    if (!loaded.ok) throw new Error(loaded.error.kind);
    expect(
      loaded.value.map(({ headword, readingKey, entry: { glosses } }) => [
        headword,
        readingKey,
        glosses.length,
      ]),
    ).toEqual([
      ["你", "ni3", 1],
      ["天", "tian1", 1],
    ]);
    expect(await db.reviews.count()).toBe(0);
  });

  it("finds nothing before any word is started", async () => {
    expect(await loadDrillWords(db, "hsk-2025")).toEqual({ ok: true, value: [] });
  });
});

describe("withAudio", () => {
  it("adds the audio pack's recording of each word, or none", async () => {
    await db.wordAudio.add({
      id: wordAudioId("你", "ni3"),
      bands: [],
      type: "audio/mpeg",
      data: new ArrayBuffer(1),
      f0: null,
      f0Version: null,
    });
    await startCards(NI, ["recall"]);
    await startCards(TIAN, ["recall"]);
    const words = await loadDrillWords(db, "hsk-2025");
    if (!words.ok) throw new Error(words.error.kind);
    const voiced = await withAudio(db, words.value);
    if (!voiced.ok) throw new Error(voiced.error.kind);
    expect(voiced.value.map(({ headword, audio }) => [headword, audio])).toEqual([
      ["你", { table: "wordAudio", id: wordAudioId("你", "ni3") }],
      ["天", null],
    ]);
  });
});
