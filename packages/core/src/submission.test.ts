import { describe, expect, it } from "vitest";
import {
  LibraryItem,
  LibraryQuery,
  LibrarySummary,
  MAX_TEXT_CHARACTERS,
  NewSubmission,
  PSEUDONYM_MAX,
  Submission,
  TITLE_MAX,
} from "./submission.ts";
import { parseWith } from "./validation.ts";

const provenance = {
  origin: "ai",
  provider: "groq",
  model: "llama-3.3-70b-versatile",
  promptVersion: "zh-story-v1",
  createdAt: "2026-10-30T09:00:00.000Z",
};

const human = {
  origin: "human",
  provenance: null,
  title: " 我的周末 ",
  body: " 我周末去公园。\n天气很好。 ",
  attribution: { kind: "anonymous" },
  attestationVersion: 1,
};

describe("NewSubmission", () => {
  it("trims a learner's text and keeps line breaks inside it", () => {
    const parsed = parseWith(NewSubmission, human);
    expect(parsed.ok && parsed.value).toMatchObject({
      title: "我的周末",
      body: "我周末去公园。\n天气很好。",
    });
  });

  it("keeps a story's provenance and drops unknown members", () => {
    const parsed = parseWith(NewSubmission, {
      ...human,
      origin: "ai",
      provenance: { ...provenance, apiKey: "secret" },
    });
    expect(parsed.ok && parsed.value.provenance).toEqual(provenance);
  });

  it("refuses a story without provenance and a learner's text with one", () => {
    expect(parseWith(NewSubmission, { ...human, origin: "ai" }).ok).toBe(false);
    expect(parseWith(NewSubmission, { ...human, provenance }).ok).toBe(false);
  });

  it("counts characters, not UTF-16 units, up to 20,000", () => {
    const at = (body: string) => parseWith(NewSubmission, { ...human, body }).ok;
    expect(at("𠀀".repeat(MAX_TEXT_CHARACTERS))).toBe(true);
    expect(at("字".repeat(MAX_TEXT_CHARACTERS + 1))).toBe(false);
    expect(at("   ")).toBe(false);
  });

  it("refuses control characters, a title on two lines and a title too long", () => {
    expect(parseWith(NewSubmission, { ...human, body: "你好\u0000" }).ok).toBe(false);
    expect(parseWith(NewSubmission, { ...human, body: "你好\u0085" }).ok).toBe(false);
    expect(parseWith(NewSubmission, { ...human, body: "你\t好\r\n" }).ok).toBe(true);
    expect(parseWith(NewSubmission, { ...human, title: "一\n二" }).ok).toBe(false);
    expect(parseWith(NewSubmission, { ...human, title: "字".repeat(TITLE_MAX + 1) }).ok).toBe(
      false,
    );
  });

  it("takes a pseudonym or anonymous", () => {
    const signed = (name: string) =>
      parseWith(NewSubmission, { ...human, attribution: { kind: "pseudonym", name } }).ok;
    expect(signed("小明")).toBe(true);
    expect(signed(" ")).toBe(false);
    expect(signed("a".repeat(PSEUDONYM_MAX + 1))).toBe(false);
  });

  it("refuses a missing or unknown attestation version and a licence chosen by the client", () => {
    const unattested = Object.fromEntries(
      Object.entries(human).filter(([key]) => key !== "attestationVersion"),
    );
    expect(parseWith(NewSubmission, unattested).ok).toBe(false);
    expect(parseWith(NewSubmission, { ...human, attestationVersion: 2 }).ok).toBe(false);
    const parsed = parseWith(NewSubmission, { ...human, licence: "CC0-1.0" });
    expect(parsed.ok && "licence" in parsed.value).toBe(false);
  });
});

const submitted = {
  id: "s1",
  title: "我的周末",
  body: "我周末去公园。",
  attribution: null,
  status: "pending",
  attestationVersion: 1,
  attestedAt: "2026-10-31T10:00:00.000Z",
  createdAt: "2026-10-31T10:00:00.000Z",
};

describe("Submission and LibraryItem", () => {
  it("tie the licence to the origin", () => {
    const humanText = { ...submitted, origin: "human", provenance: null };
    expect(parseWith(Submission, { ...humanText, licence: "CC-BY-SA-4.0" }).ok).toBe(true);
    expect(parseWith(Submission, { ...humanText, licence: "CC0-1.0" }).ok).toBe(false);
    const story = { ...submitted, origin: "ai", provenance, licence: "CC0-1.0" };
    expect(parseWith(Submission, story).ok).toBe(true);
    expect(parseWith(Submission, { ...story, licence: "CC-BY-SA-4.0" }).ok).toBe(false);
  });

  it("describe a published text with its level, licence, provenance and attribution", () => {
    const summary = {
      id: "s1",
      title: "小猫",
      attribution: "小明",
      origin: "ai",
      provenance,
      licence: "CC0-1.0",
      band: 2,
      publishedAt: "2026-10-31T12:00:00.000Z",
    };
    expect(parseWith(LibrarySummary, summary)).toEqual({ ok: true, value: summary });
    const item = { ...summary, body: "小猫很可爱。" };
    expect(parseWith(LibraryItem, item)).toEqual({ ok: true, value: item });
    expect(parseWith(LibraryItem, { ...item, band: 0 }).ok).toBe(false);
    expect(parseWith(LibraryItem, { ...item, licence: "CC-BY-SA-4.0" }).ok).toBe(false);
  });
});

describe("LibraryQuery", () => {
  it("reads an absent or positive band and page from the query string", () => {
    expect(parseWith(LibraryQuery, { band: null, page: null })).toEqual({
      ok: true,
      value: { band: null, page: null },
    });
    expect(parseWith(LibraryQuery, { band: "3", page: "2" })).toEqual({
      ok: true,
      value: { band: 3, page: 2 },
    });
  });

  it.each([
    { band: "0", page: null },
    { band: "10", page: null },
    { band: "2.5", page: null },
    { band: null, page: "0" },
    { band: null, page: "-1" },
    { band: null, page: "abc" },
  ])("refuses %o", (query) => {
    expect(parseWith(LibraryQuery, query).ok).toBe(false);
  });
});
