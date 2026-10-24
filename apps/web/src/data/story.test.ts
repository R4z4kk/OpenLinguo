import "fake-indexeddb/auto";
import {
  cardId,
  CURRENT_SCHEDULER,
  NEW_CARD_STATE,
  ok,
  type AiProvenance,
  type CardKey,
  type CardState,
  type CardType,
  type StoryAnswer,
} from "@openlinguo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "./database.ts";
import { fromCache } from "./unknown-words.ts";
import { learningWords, saveStory, STORY_WORDS_MAX } from "./story.ts";
import { TITLE_MAX } from "./texts.ts";

const HOUR = 60 * 60_000;
const AT = Date.UTC(2026, 9, 24, 10);
const ID = "6f1f3c8e-2f0b-4c8e-9a52-0b6f3b3c1a02";

const PROVENANCE: AiProvenance = {
  origin: "ai",
  provider: "groq",
  model: "openai/gpt-oss-20b",
  promptVersion: "zh-story-v1",
  createdAt: "2026-10-24T10:00:00.000Z",
};

const ANSWER: StoryAnswer = {
  title: "周末的公园",
  paragraphs: ["今天天气很好。", "我和丁丹妮去公园。"],
  names: [{ text: "丁丹妮", kind: "person" }],
};

let db: Database;
let counter = 0;

beforeEach(() => {
  counter += 1;
  db = openDatabase(`story-test-${String(counter)}`);
});

const state = (phase: CardState["phase"]): CardState => ({ ...NEW_CARD_STATE, phase });

type Seeded = {
  readonly headword: string;
  readonly readingKey: string;
  readonly phase: CardState["phase"];
  readonly types: readonly CardType[];
  /** The review times, in hours after `AT`, one review per entry on each card. */
  readonly reviews: readonly number[];
};

const word = (
  headword: string,
  phase: CardState["phase"],
  reviews: readonly number[] = [],
  { readingKey, types }: Pick<Seeded, "readingKey" | "types"> = {
    readingKey: "x",
    types: ["recognition"],
  },
): Seeded => ({ headword, readingKey, phase, types, reviews });

const seed = async (cards: readonly Seeded[]): Promise<void> => {
  for (const { headword, readingKey, phase, types, reviews } of cards) {
    for (const type of types) {
      const key: CardKey = { language: "zh", headword, readingKey, type };
      const id = cardId(key);
      await db.cards.add({ ...key, id, ...state(phase) });
      await db.reviews.bulkAdd(
        reviews.map((hours) => ({
          id: crypto.randomUUID(),
          cardId: id,
          grade: "good" as const,
          reviewedAt: AT + hours * HOUR,
          utcOffsetMinutes: 0,
          scheduler: CURRENT_SCHEDULER,
          dailyGoal: 10,
          wordDone: false,
        })),
      );
    }
  }
};

const named = (index: number): string => `词${String.fromCodePoint(0x4e00 + index)}`;

describe("learningWords", () => {
  it("lists the words in their learning steps, the most recently reviewed first", async () => {
    await seed([
      word("旅游", "learning", [1]),
      word("照片", "learning", [5, 2]),
      word("礼物", "learning", [3]),
    ]);
    expect(await learningWords(db, "zh")).toEqual(ok(["照片", "礼物", "旅游"]));
  });

  it("counts a word once, by the latest review of any of its cards", async () => {
    await seed([
      word("旅游", "learning", [1], { readingKey: "a", types: ["recognition"] }),
      word("照片", "learning", [], { readingKey: "a", types: ["recognition", "recall"] }),
      word("旅游", "learning", [4], { readingKey: "b", types: ["recognition"] }),
      word("礼物", "learning", [2]),
    ]);
    expect(await learningWords(db, "zh")).toEqual(ok(["旅游", "礼物", "照片"]));
  });

  it("breaks ties on the headword so that the order is stable", async () => {
    await seed([word("照片", "learning", [1]), word("旅游", "learning", [1])]);
    expect(await learningWords(db, "zh")).toEqual(ok(["旅游", "照片"]));
  });

  it("leaves out new, review and relearning cards, and readings known otherwise", async () => {
    await seed([
      word("新", "new"),
      word("复习", "review", [9]),
      word("重学", "relearning", [9]),
      word("旅游", "learning", [1]),
      word("照片", "learning", [2]),
      word("照片", "review", [3], { readingKey: "x", types: ["recall"] }),
      word("礼物", "learning", [4]),
    ]);
    await db.knownMarks.add({ headword: "礼物", readingKey: "x", markedAt: AT });
    expect(await learningWords(db, "zh")).toEqual(ok(["旅游"]));
  });

  it("leaves out notes and the cards of another language", async () => {
    await db.cards.add({
      id: "note-card",
      language: "zh",
      type: "recognition",
      note: "n1",
      ...state("learning"),
    });
    const key: CardKey = {
      language: "en",
      headword: "river",
      readingKey: "x",
      type: "recognition",
    };
    await db.cards.add({ ...key, id: cardId(key), ...state("learning") });
    expect(await learningWords(db, "zh")).toEqual(ok([]));
  });

  it("stops at the limit, the 20 words of the prompt by default", async () => {
    expect(STORY_WORDS_MAX).toBe(20);
    await seed(Array.from({ length: 25 }, (_, index) => word(named(index), "learning", [index])));
    const newest = named;
    const words = await learningWords(db, "zh");
    expect(words.ok && words.value).toHaveLength(20);
    expect(words.ok && words.value[0]).toBe(newest(24));
    expect(await learningWords(db, "zh", 2)).toEqual(ok([newest(24), newest(23)]));
  });

  it("is empty when nothing is being learned", async () => {
    expect(await learningWords(db, "zh")).toEqual(ok([]));
  });

  it("reports a storage failure instead of throwing", async () => {
    db.close();
    expect(await learningWords(db, "zh")).toMatchObject({
      ok: false,
      error: { kind: "storage" },
    });
  });
});

describe("saveStory", () => {
  it("keeps the story as an AI text with its provenance, one paragraph per line", async () => {
    const saved = await saveStory(db, ANSWER, PROVENANCE, AT, ID);
    expect(saved).toEqual(
      ok({
        id: ID,
        title: "周末的公园",
        body: "今天天气很好。\n我和丁丹妮去公园。",
        source: "ai",
        createdAt: AT,
        provenance: PROVENANCE,
        readingChoices: {},
      }),
    );
    expect(await db.texts.get(ID)).toEqual(saved.ok ? saved.value : null);
  });

  it("keeps each name as an AI answer to propose, with the story's provenance", async () => {
    await saveStory(db, ANSWER, PROVENANCE, AT, ID);
    expect(await db.resolutions.toArray()).toEqual([
      {
        sequence: "丁丹妮",
        source: "ai",
        found: [
          { kind: "person", reading: null, gloss: null, reference: null, provenance: PROVENANCE },
        ],
        checkedAt: AT,
      },
    ]);
    const cached = await fromCache(db, ["丁丹妮"]);
    expect(cached).toEqual(
      ok(
        new Map([
          [
            "丁丹妮",
            {
              proposals: [
                {
                  source: "ai",
                  kind: "person",
                  reading: null,
                  gloss: null,
                  reference: null,
                  provenance: PROVENANCE,
                },
              ],
              checks: [{ source: "ai", checkedAt: AT, found: 1 }],
            },
          ],
        ]),
      ),
    );
  });

  it("keeps a name once and leaves an earlier AI answer for the same sequence alone", async () => {
    const earlier = {
      sequence: "袁家界",
      source: "ai" as const,
      found: [
        {
          kind: "place" as const,
          reading: null,
          gloss: "a scenic area",
          reference: null,
          provenance: null,
        },
      ],
      checkedAt: AT - HOUR,
    };
    await db.resolutions.add(earlier);
    await saveStory(
      db,
      {
        ...ANSWER,
        names: [
          { text: "袁家界", kind: "place" },
          { text: "丁丹妮", kind: "person" },
          { text: " 丁丹妮 ", kind: "person" },
        ],
      },
      PROVENANCE,
      AT,
      ID,
    );
    const rows = await db.resolutions.toArray();
    expect(rows.map(({ sequence }) => sequence).toSorted()).toEqual(["丁丹妮", "袁家界"]);
    expect(rows.find(({ sequence }) => sequence === "袁家界")).toEqual(earlier);
  });

  it("keeps no name row for a story with no name", async () => {
    await saveStory(db, { ...ANSWER, names: [] }, PROVENANCE, AT, ID);
    expect(await db.resolutions.count()).toBe(0);
  });

  it("stores nothing for a blank story", async () => {
    const saved = await saveStory(db, { ...ANSWER, paragraphs: [" ", "\n"] }, PROVENANCE, AT, ID);
    expect(saved).toEqual({ ok: false, error: { kind: "empty" } });
    expect(await db.texts.count()).toBe(0);
    expect(await db.resolutions.count()).toBe(0);
  });

  it("stores nothing when the title is over its limit", async () => {
    const saved = await saveStory(
      db,
      { ...ANSWER, title: "题".repeat(TITLE_MAX + 1) },
      PROVENANCE,
      AT,
      ID,
    );
    expect(saved).toEqual({ ok: false, error: { kind: "title-too-long", max: TITLE_MAX } });
    expect(await db.texts.count()).toBe(0);
    expect(await db.resolutions.count()).toBe(0);
  });

  it("stores neither the text nor the names when one write fails", async () => {
    vi.spyOn(db.resolutions, "bulkAdd").mockRejectedValueOnce(new Error("QuotaExceededError"));
    const saved = await saveStory(db, ANSWER, PROVENANCE, AT, ID);
    expect(saved).toMatchObject({ ok: false, error: { kind: "storage" } });
    expect(await db.texts.count()).toBe(0);
    expect(await db.resolutions.count()).toBe(0);
  });
});
