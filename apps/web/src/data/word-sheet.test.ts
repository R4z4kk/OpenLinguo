import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "./database.ts";
import { saveText } from "./texts.ts";
import { chooseReading, describeSheetFailure, isMarked, setKnownMark } from "./word-sheet.ts";

const ID = "6f1f3c8e-2f0b-4c8e-9a52-0b6f3b3c1a01";
const AT = Date.UTC(2026, 9, 24, 10);
const WORD = { headword: "和", readingKey: "he2" };

let db: Database;
let counter = 0;

beforeEach(async () => {
  counter += 1;
  db = openDatabase(`word-sheet-test-${String(counter)}`);
  await saveText(db, { title: "", body: "我和你", source: "paste" }, AT, ID);
});

describe("chooseReading", () => {
  it("stores the reading under the offset of the token and keeps the other choices", async () => {
    expect(await chooseReading(db, ID, 1, "hé")).toEqual({ ok: true, value: { 1: "hé" } });
    expect(await chooseReading(db, ID, 5, "hàn")).toEqual({
      ok: true,
      value: { 1: "hé", 5: "hàn" },
    });
    expect((await db.texts.get(ID))?.readingChoices).toEqual({ 1: "hé", 5: "hàn" });
  });

  it("replaces an earlier choice for the same occurrence", async () => {
    await chooseReading(db, ID, 1, "hé");
    await chooseReading(db, ID, 1, "huò");
    expect((await db.texts.get(ID))?.readingChoices).toEqual({ 1: "huò" });
  });

  it("fails on a text that is not stored", async () => {
    expect(await chooseReading(db, "missing", 1, "hé")).toEqual({
      ok: false,
      error: { kind: "unknown-text", textId: "missing" },
    });
  });
});

describe("setKnownMark", () => {
  it("marks a reading, once, and unmarks it", async () => {
    expect(await isMarked(db, WORD)).toEqual({ ok: true, value: false });
    expect(await setKnownMark(db, WORD, true, AT)).toEqual({ ok: true, value: null });
    expect(await setKnownMark(db, WORD, true, AT + 1)).toEqual({ ok: true, value: null });
    expect(await isMarked(db, WORD)).toEqual({ ok: true, value: true });
    expect(await db.knownMarks.toArray()).toEqual([{ ...WORD, markedAt: AT + 1 }]);
    expect(await setKnownMark(db, WORD, false, AT + 2)).toEqual({ ok: true, value: null });
    expect(await isMarked(db, WORD)).toEqual({ ok: true, value: false });
  });

  it("marks one reading of a headword, not its other readings", async () => {
    await setKnownMark(db, WORD, true, AT);
    expect(await isMarked(db, { headword: "和", readingKey: "huo2" })).toEqual({
      ok: true,
      value: false,
    });
  });

  it("unmarking a reading that is not marked is not an error", async () => {
    expect(await setKnownMark(db, WORD, false, AT)).toEqual({ ok: true, value: null });
  });

  it("reports a storage failure instead of throwing", async () => {
    db.close();
    const result = await setKnownMark(db, WORD, true, AT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(describeSheetFailure(result.error)).not.toBe("");
  });
});

describe("describeSheetFailure", () => {
  it("names the text of an unknown-text failure", () => {
    expect(describeSheetFailure({ kind: "unknown-text", textId: ID })).toBe(`unknown-text ${ID}`);
  });
});
