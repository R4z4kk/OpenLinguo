import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { SentenceCorrection } from "./correction.ts";
import { openDatabase, type Database } from "./database.ts";
import type { LocalTime } from "./decks.ts";
import {
  journalDay,
  journalSentences,
  listPastEntries,
  loadJournalEntry,
  saveJournalEntry,
} from "./journal.ts";

const MINUTE = 60_000;
// Paris summer, 12:00 on 2026-10-21.
const NOON: LocalTime = { at: Date.UTC(2026, 9, 21, 10), utcOffsetMinutes: 120 };
const at = (minutes: number): LocalTime => ({ ...NOON, at: NOON.at + minutes * MINUTE });
const TODAY = "2026-10-21";

const CORRECTED: SentenceCorrection = {
  original: "我很累。",
  corrected: "我很累。",
  changes: [],
  reading: "wǒ hěn lèi .",
  meaning: "I am tired.",
  choice: null,
  provenance: {
    origin: "ai",
    provider: "local",
    model: "qwen3:30b-a3b",
    promptVersion: "zh-correct-v1",
    createdAt: "2026-10-21T10:00:00.000Z",
  },
};

let db: Database;
let counter = 0;

beforeEach(() => {
  counter += 1;
  db = openDatabase(`journal-test-${String(counter)}`);
});

describe("journalSentences", () => {
  it("splits after each full stop, question or exclamation mark, quotes kept", () => {
    expect(journalSentences("今天我去超市买了水果。我觉得很累，但是很开心！")).toEqual([
      "今天我去超市买了水果。",
      "我觉得很累，但是很开心！",
    ]);
    expect(journalSentences("他说：“你好！”然后走了。")).toEqual(["他说：“你好！”", "然后走了。"]);
  });

  it("splits at line breaks, keeps a last sentence without a mark and drops blanks", () => {
    expect(journalSentences(" 第一行\n\n第二行。  没有句号 ")).toEqual([
      "第一行",
      "第二行。",
      "没有句号",
    ]);
    expect(journalSentences(" \n ")).toEqual([]);
  });
});

describe("one entry per learning day", () => {
  it("rolls over at 4:00, not at midnight", () => {
    // 3:59 on 2026-10-22 is still the learning day of 2026-10-21.
    expect(journalDay(at(15 * 60 + 59))).toBe(TODAY);
    expect(journalDay(at(16 * 60))).toBe("2026-10-22");
  });

  it("keeps one entry for the day, the text saved last", async () => {
    const day = journalDay(NOON);
    await saveJournalEntry(db, { day, text: "我很累。", corrections: [] }, NOON.at);
    await saveJournalEntry(
      db,
      { day: journalDay(at(15 * 60)), text: "我很累。我想睡觉。", corrections: [] },
      at(15 * 60).at,
    );
    expect(await db.journal.toArray()).toEqual([
      {
        day: TODAY,
        text: "我很累。我想睡觉。",
        corrections: [null, null],
        updatedAt: at(15 * 60).at,
      },
    ]);
    expect(await loadJournalEntry(db, TODAY)).toMatchObject({
      ok: true,
      value: { day: TODAY, text: "我很累。我想睡觉。" },
    });
    expect(await loadJournalEntry(db, "2026-10-22")).toEqual({ ok: true, value: null });
  });

  it("writes nothing while the text is empty, then lets a saved one be emptied", async () => {
    expect(await saveJournalEntry(db, { day: TODAY, text: " ", corrections: [] }, 1)).toEqual({
      ok: true,
      value: false,
    });
    expect(await db.journal.count()).toBe(0);
    await saveJournalEntry(db, { day: TODAY, text: "我很累。", corrections: [] }, 1);
    expect(await saveJournalEntry(db, { day: TODAY, text: "", corrections: [] }, 2)).toEqual({
      ok: true,
      value: true,
    });
    expect((await db.journal.get(TODAY))?.text).toBe("");
  });

  it("keeps a correction while its sentence is the one corrected", async () => {
    const other = { ...CORRECTED, original: "我想睡觉。" };
    await saveJournalEntry(
      db,
      { day: TODAY, text: "我很累。我要睡觉。", corrections: [CORRECTED, other] },
      1,
    );
    expect((await db.journal.get(TODAY))?.corrections).toEqual([CORRECTED, null]);
  });

  it("lists the entries before a day, the latest first", async () => {
    for (const day of ["2026-10-19", TODAY, "2026-10-20"])
      await saveJournalEntry(db, { day, text: "我很累。", corrections: [] }, 1);
    const listed = await listPastEntries(db, TODAY);
    expect(listed.ok && listed.value.map(({ day }) => day)).toEqual(["2026-10-20", "2026-10-19"]);
  });
});
