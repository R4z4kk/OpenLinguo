import { describe, expect, it } from "vitest";
import type { AnnotatedToken } from "./language-pack.ts";
import {
  bandName,
  Approval,
  estimateBand,
  Ground,
  isLegalGround,
  NewStatementOfReasons,
  STATEMENT_MAX,
  StatementOfReasons,
  TERMS_CLAUSES,
} from "./moderation.ts";
import { parseWith } from "./validation.ts";

const token = (text: string, inDictionary = true, isWord = true): AnnotatedToken => ({
  text,
  start: 0,
  end: text.length,
  isWord,
  readings: inDictionary ? ["x"] : [],
  ambiguous: false,
});

/** `count` tokens of one word. */
const tokens = (text: string, count: number, inDictionary = true) =>
  Array.from({ length: count }, () => token(text, inDictionary));

describe("estimateBand", () => {
  const levels = new Map<string, number | null>([
    ["我", 1],
    ["喜欢", 1],
    ["周末", 2],
    ["公园", 3],
    ["踌躇", 7],
    ["龃龉", null],
  ]);

  it("picks the lowest level whose words cover 98 % of the Han word tokens", () => {
    const text = [...tokens("我", 97), ...tokens("周末", 2), token("公园")];
    expect(estimateBand(text, levels)).toEqual({
      band: 2,
      byLevel: [97, 2, 1, 0, 0, 0, 0],
      outside: 0,
      total: 100,
    });
  });

  it("counts 98 % exactly as reached", () => {
    const text = [...tokens("我", 49), token("公园")];
    expect(estimateBand(text, levels)?.band).toBe(1);
  });

  it("leaves out punctuation, Latin letters and words the dictionary lacks", () => {
    const text = [
      ...tokens("我", 10),
      token("。", true, false),
      token("OK"),
      ...tokens("王小红", 5, false),
    ];
    expect(estimateBand(text, levels)).toMatchObject({ band: 1, total: 10 });
  });

  it("answers 7-9 when even every level stays under the target", () => {
    const text = [...tokens("我", 10), token("龃龉")];
    expect(estimateBand(text, levels)).toEqual({
      band: 7,
      byLevel: [10, 0, 0, 0, 0, 0, 0],
      outside: 1,
      total: 11,
    });
  });

  it("answers null without a Han word to count", () => {
    expect(estimateBand([token("hello"), ...tokens("王", 2, false)], levels)).toBeNull();
  });
});

describe("NewStatementOfReasons", () => {
  const statement = {
    ground: "copyright",
    facts: " Le texte reprend un chapitre publié. ",
    explanation: "Il est reproduit sans l'accord de l'auteur.",
  };

  it("trims the facts and keeps the ground", () => {
    const parsed = parseWith(NewStatementOfReasons, statement);
    expect(parsed.ok && parsed.value.facts).toBe("Le texte reprend un chapitre publié.");
  });

  it("refuses an unknown ground, empty facts and an over-long explanation", () => {
    for (const invalid of [
      { ...statement, ground: "boring" },
      { ...statement, facts: "  " },
      { ...statement, explanation: "字".repeat(STATEMENT_MAX + 1) },
    ]) {
      expect(parseWith(NewStatementOfReasons, invalid).ok).toBe(false);
    }
  });

  it("splits legal grounds from the library's rules", () => {
    expect(Ground.options.filter(isLegalGround)).toEqual([
      "copyright",
      "defamation",
      "hate",
      "personal-data",
      "serious-offences",
    ]);
    expect(Ground.options.filter((ground) => !isLegalGround(ground))).toEqual(
      Object.keys(TERMS_CLAUSES),
    );
  });
});

describe("StatementOfReasons", () => {
  it("says the decision was taken without automated means", () => {
    const decision = {
      id: "d1",
      submissionId: "s1",
      measure: "rejected",
      source: "own-initiative",
      ground: "not-chinese",
      facts: "Le texte est en anglais.",
      explanation: "La bibliothèque accueille des textes en chinois.",
      automated: false,
      decidedAt: "2026-10-31T10:00:00.000Z",
    };
    expect(parseWith(StatementOfReasons, decision).ok).toBe(true);
    expect(parseWith(StatementOfReasons, { ...decision, automated: true }).ok).toBe(false);
  });
});

describe("Approval", () => {
  it("takes a band from 1 to 7", () => {
    expect(parseWith(Approval, { band: 7 }).ok).toBe(true);
    expect(parseWith(Approval, { band: 0 }).ok).toBe(false);
    expect(parseWith(Approval, { band: 2.5 }).ok).toBe(false);
  });
});

describe("bandName", () => {
  it("names a band as HSK 2025 does", () => {
    expect(bandName(1)).toBe("1");
    expect(bandName(7)).toBe("7-9");
  });
});
