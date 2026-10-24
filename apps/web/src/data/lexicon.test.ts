import "fake-indexeddb/auto";
import { ok } from "@openlinguo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "./database.ts";
import {
  acceptEntry,
  checkEntry,
  HEADWORD_MAX,
  loadLexicon,
  removeEntry,
  type EntryDraft,
} from "./lexicon.ts";

const AT = Date.UTC(2026, 9, 24);
const draft: EntryDraft = {
  headword: " 王小红 ",
  kind: "person",
  reading: " Wang2 xiao3 hong2 ",
  gloss: " a singer ",
  source: "name-signal",
  provenance: null,
};

let db: Database;
let counter = 0;

beforeEach(() => {
  counter += 1;
  db = openDatabase(`lexicon-test-${String(counter)}`);
});

describe("checkEntry", () => {
  it("stores the headword trimmed and the reading in the dictionary's form", () => {
    expect(checkEntry(draft)).toEqual(
      ok({
        headword: "王小红",
        kind: "person",
        reading: "wang2 xiao3 hong2",
        gloss: "a singer",
        source: "name-signal",
        provenance: null,
      }),
    );
  });

  it("keeps an empty reading and an empty meaning as none", () => {
    expect(checkEntry({ ...draft, reading: " ", gloss: "" })).toMatchObject(
      ok({ reading: null, gloss: null }),
    );
  });

  it("keeps the provenance of an AI proposal through the learner's edits", () => {
    const provenance = {
      origin: "ai",
      provider: "groq",
      model: "m",
      promptVersion: "zh-explain-v1",
      createdAt: "2026-10-24T08:00:00.000Z",
    } as const;
    expect(checkEntry({ ...draft, source: "ai", provenance, gloss: "edited" })).toMatchObject(
      ok({ source: "ai", provenance, gloss: "edited" }),
    );
  });

  it("refuses what the segmenter cannot use", () => {
    expect(checkEntry({ ...draft, headword: "" })).toEqual({
      ok: false,
      error: { kind: "not-han" },
    });
    expect(checkEntry({ ...draft, headword: "王 红" })).toMatchObject({ ok: false });
    expect(checkEntry({ ...draft, headword: "Wang红" })).toMatchObject({ ok: false });
    expect(checkEntry({ ...draft, headword: "王".repeat(HEADWORD_MAX + 1) })).toEqual({
      ok: false,
      error: { kind: "too-long", max: HEADWORD_MAX },
    });
    expect(checkEntry({ ...draft, reading: "wang hong" })).toEqual({
      ok: false,
      error: { kind: "invalid-reading", reading: "wang hong" },
    });
  });
});

describe("the personal lexicon", () => {
  const entry = (headword: string, kind: EntryDraft["kind"]) => {
    const checked = checkEntry({ ...draft, headword, kind });
    if (!checked.ok) throw new Error(checked.error.kind);
    return checked.value;
  };

  it("segments every entry as a word, and counts only proper names as known", async () => {
    await acceptEntry(db, entry("王小红", "person"), AT);
    await acceptEntry(db, entry("袁家界", "place"), AT);
    await acceptEntry(db, entry("热可可", "word"), AT);
    const lexicon = await loadLexicon(db);
    if (!lexicon.ok) throw new Error(lexicon.error.kind);
    expect([...lexicon.value.headwords].toSorted()).toEqual(
      ["热可可", "王小红", "袁家界"].toSorted(),
    );
    expect([...lexicon.value.names].toSorted()).toEqual(["王小红", "袁家界"].toSorted());
  });

  it("dates the entry when it is kept, now unless told", async () => {
    await acceptEntry(db, entry("王小红", "person"), AT);
    expect(await db.lexicon.get("王小红")).toMatchObject({ validatedAt: AT });
    const before = Date.now();
    await acceptEntry(db, entry("袁家界", "place"));
    const kept = await db.lexicon.get("袁家界");
    expect(kept?.validatedAt).toBeGreaterThanOrEqual(before);
  });

  it("replaces an entry of the same headword, and removes one", async () => {
    await acceptEntry(db, entry("王小红", "person"), AT);
    await acceptEntry(db, entry("王小红", "place"), AT);
    expect(await db.lexicon.toArray()).toMatchObject([{ headword: "王小红", kind: "place" }]);
    expect(await removeEntry(db, "王小红")).toEqual(ok(null));
    expect(await db.lexicon.count()).toBe(0);
  });
});
