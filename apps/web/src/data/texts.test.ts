import "fake-indexeddb/auto";
import { err, ok } from "@openlinguo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "./database.ts";
import {
  characterCount,
  checkDraft,
  defaultTitle,
  deleteText,
  listTexts,
  MAX_TEXT_CHARACTERS,
  saveText,
  TITLE_MAX,
} from "./texts.ts";

const ID = "6f1f3c8e-2f0b-4c8e-9a52-0b6f3b3c1a01";
const AT = Date.UTC(2026, 9, 21, 10);

let db: Database;
let counter = 0;

beforeEach(() => {
  counter += 1;
  db = openDatabase(`texts-test-${String(counter)}`);
});

describe("characterCount", () => {
  it("counts characters, not UTF-16 units", () => {
    expect(characterCount("好")).toBe(1);
    expect(characterCount("𠀀好")).toBe(2);
    expect(characterCount("a\nb")).toBe(3);
  });
});

describe("defaultTitle", () => {
  it("takes the first characters of the first line and marks the cut", () => {
    expect(defaultTitle("晚上八点，小明给妈妈打电话。她说好。")).toBe("晚上八点，小明给妈妈打电…");
    expect(defaultTitle("你好吗")).toBe("你好吗");
  });

  it("skips blank lines and collapses spaces", () => {
    expect(defaultTitle("\n  \n 我   爱\t你 \n下一行")).toBe("我 爱 你");
  });
});

describe("checkDraft", () => {
  it("trims the text and keeps a title the learner typed", () => {
    expect(checkDraft({ title: " 周末 ", body: "\n我去张家界。\n" })).toEqual(
      ok({ title: "周末", body: "我去张家界。" }),
    );
  });

  it("falls back to the first characters when the title is blank", () => {
    expect(checkDraft({ title: "  ", body: "我去张家界。" })).toEqual(
      ok({ title: "我去张家界。", body: "我去张家界。" }),
    );
  });

  it("refuses a blank text", () => {
    expect(checkDraft({ title: "x", body: " \n " })).toEqual(err({ kind: "empty" }));
  });

  it("accepts exactly the limit and refuses one character more, saying by how many", () => {
    expect(checkDraft({ title: "", body: "好".repeat(MAX_TEXT_CHARACTERS) }).ok).toBe(true);
    expect(checkDraft({ title: "", body: "好".repeat(MAX_TEXT_CHARACTERS + 3) })).toEqual(
      err({ kind: "too-long", count: MAX_TEXT_CHARACTERS + 3, max: MAX_TEXT_CHARACTERS }),
    );
  });

  it("refuses a title above its limit", () => {
    expect(checkDraft({ title: "好".repeat(TITLE_MAX + 1), body: "好" })).toEqual(
      err({ kind: "title-too-long", max: TITLE_MAX }),
    );
  });
});

describe("saveText", () => {
  it("stores a pasted text with no provenance and no chosen reading", async () => {
    const saved = await saveText(db, { title: "", body: "我去张家界。", source: "paste" }, AT, ID);
    const expected = {
      id: ID,
      title: "我去张家界。",
      body: "我去张家界。",
      source: "paste",
      createdAt: AT,
      provenance: null,
      readingChoices: {},
    };
    expect(saved).toEqual(ok(expected));
    expect(await db.texts.toArray()).toEqual([expected]);
  });

  it("stores nothing for a text over the limit", async () => {
    const saved = await saveText(
      db,
      { title: "", body: "好".repeat(MAX_TEXT_CHARACTERS + 1), source: "file" },
      AT,
      ID,
    );
    expect(saved).toMatchObject({ ok: false, error: { kind: "too-long" } });
    expect(await db.texts.count()).toBe(0);
  });

  it("reports a storage failure", async () => {
    await db.texts.add({
      id: ID,
      title: "a",
      body: "a",
      source: "paste",
      createdAt: AT,
      provenance: null,
      readingChoices: {},
    });
    const saved = await saveText(db, { title: "", body: "我", source: "paste" }, AT, ID);
    expect(saved).toMatchObject({ ok: false, error: { kind: "storage" } });
  });
});

const listedIds = async (database: Database): Promise<readonly string[]> => {
  const listed = await listTexts(database);
  if (!listed.ok) throw new Error(listed.error.kind);
  return listed.value.map(({ id }) => id);
};

describe("listTexts and deleteText", () => {
  it("lists the latest text first and deletes only the one asked", async () => {
    const first = await saveText(db, { title: "一", body: "一", source: "paste" }, AT, "id-1");
    const second = await saveText(db, { title: "二", body: "二", source: "file" }, AT + 1, "id-2");
    const third = await saveText(db, { title: "三", body: "三", source: "paste" }, AT + 2, "id-3");
    expect([first.ok, second.ok, third.ok]).toEqual([true, true, true]);
    expect(await listedIds(db)).toEqual(["id-3", "id-2", "id-1"]);

    expect(await deleteText(db, "id-2")).toEqual(ok(null));
    expect(await listedIds(db)).toEqual(["id-3", "id-1"]);
  });

  it("leaves the marks and cards alone when a text is deleted", async () => {
    await db.knownMarks.add({ headword: "好", readingKey: "hao3", markedAt: AT });
    await saveText(db, { title: "", body: "好", source: "paste" }, AT, ID);
    await deleteText(db, ID);
    expect(await db.knownMarks.count()).toBe(1);
  });
});
