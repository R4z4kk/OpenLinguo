import "fake-indexeddb/auto";
import type { AiProvenance } from "@openlinguo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPLAIN_MAX, explainInput, saveExplanations, unexplained } from "./ai-explain.ts";
import { openDatabase, type Database } from "./database.ts";
import type { Proposal } from "./lexicon.ts";
import { fromCache, type UnknownWord } from "./unknown-words.ts";

const NOW = Date.UTC(2026, 9, 30);

const PROVENANCE: AiProvenance = {
  origin: "ai",
  provider: "groq",
  model: "openai/gpt-oss-20b",
  promptVersion: "zh-explain-v1",
  createdAt: new Date(NOW).toISOString(),
};

const proposal = (extra: Partial<Proposal>): Proposal => ({
  source: "ai",
  kind: "person",
  reading: null,
  gloss: null,
  reference: null,
  provenance: PROVENANCE,
  ...extra,
});

const word = (text: string, extra: Partial<UnknownWord> = {}): UnknownWord => ({
  text,
  start: 0,
  end: text.length,
  compositional: false,
  before: "",
  after: "",
  wikidata: true,
  proposals: [],
  checks: [],
  ...extra,
});

let db: Database;
let counter = 0;

beforeEach(() => {
  counter += 1;
  db = openDatabase(`ai-explain-test-${String(counter)}`);
});

describe("unexplained", () => {
  it("sends what the AI has not explained, story names included, common runs last", () => {
    const aiCheck = (found: number) => [{ source: "ai", checkedAt: NOW, found }] as const;
    const sent = unexplained([
      word("他也是", { compositional: true }),
      word("王芳", { proposals: [proposal({ gloss: "a name" })], checks: aiCheck(1) }),
      word("袁家界拍", { checks: aiCheck(0) }),
      word("李明", { proposals: [proposal({})], checks: aiCheck(1) }),
      word("红白机", { checks: [{ source: "wikidata", checkedAt: NOW, found: 0 }] }),
    ]);
    expect(sent.map(({ text }) => text)).toEqual(["李明", "红白机", "他也是"]);
  });
});

describe("explainInput", () => {
  it(`sends the first ${String(EXPLAIN_MAX)} sequences`, () => {
    const words = Array.from({ length: EXPLAIN_MAX + 3 }, (_, at) => word(`王${String(at)}`));
    expect(explainInput(words, "en").sequences).toHaveLength(EXPLAIN_MAX);
  });

  it("sends each sequence with its whole sentence", () => {
    expect(
      explainInput([word("王芳", { before: "我的同学", after: "和老师去玩了。" })], "fr"),
    ).toEqual({
      sequences: [{ sequence: "王芳", sentence: "我的同学王芳和老师去玩了。" }],
      language: "fr",
    });
  });
});

describe("saveExplanations", () => {
  const input = explainInput([word("王芳"), word("袁家界拍"), word("红白机")], "en");
  const answer = {
    sequences: [
      { index: 3, kind: "word", meaning: " Nintendo Entertainment System " },
      { index: 1, kind: "person", meaning: "Wang Fang, Chinese name" },
      { index: 2, kind: "not-a-word", meaning: "" },
    ],
  } as const;

  it("keeps each answer by its index, a meaning as a proposal and « not a word » as nothing", async () => {
    expect(await saveExplanations(db, input, answer, PROVENANCE, NOW)).toEqual({
      ok: true,
      value: 3,
    });
    const cached = await fromCache(db, ["王芳", "袁家界拍", "红白机"]);
    if (!cached.ok) throw new Error("unreadable");
    expect(cached.value.get("王芳")?.proposals).toEqual([
      proposal({ gloss: "Wang Fang, Chinese name" }),
    ]);
    expect(cached.value.get("红白机")?.proposals).toEqual([
      proposal({ kind: "word", gloss: "Nintendo Entertainment System" }),
    ]);
    expect(cached.value.get("袁家界拍")).toEqual({
      proposals: [],
      checks: [{ source: "ai", checkedAt: NOW, found: 0 }],
    });
  });

  it("replaces a story name and leaves Wikidata's answer", async () => {
    await db.resolutions.bulkAdd([
      { sequence: "王芳", source: "ai", found: [proposal({})], checkedAt: NOW - 1 },
      { sequence: "王芳", source: "wikidata", found: [], checkedAt: NOW - 1 },
    ]);
    await saveExplanations(db, input, answer, PROVENANCE, NOW);
    const rows = await db.resolutions.where("sequence").equals("王芳").toArray();
    expect(rows.map(({ source, found }) => [source, found.map(({ gloss }) => gloss)])).toEqual([
      ["ai", ["Wang Fang, Chinese name"]],
      ["wikidata", []],
    ]);
  });

  it("returns a storage failure instead of throwing, with nothing kept", async () => {
    vi.spyOn(db.resolutions, "bulkPut").mockRejectedValueOnce(new Error("QuotaExceededError"));
    expect(await saveExplanations(db, input, answer, PROVENANCE, NOW)).toEqual({
      ok: false,
      error: { kind: "storage", message: "Error: QuotaExceededError" },
    });
    expect(await db.resolutions.count()).toBe(0);
  });
});
