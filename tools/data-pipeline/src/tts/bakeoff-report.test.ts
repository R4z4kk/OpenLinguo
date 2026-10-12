import { describe, expect, it } from "vitest";
import { formatReport, makeKey, reveal, type Grades } from "./bakeoff-report.ts";
import { BAKEOFF_SET } from "./bakeoff-set.ts";
import { ENGINE_IDS } from "./engines.ts";

const items = BAKEOFF_SET.filter(({ id }) => id === "ma1" || id === "nihao");
const key = makeKey(items, ENGINE_IDS);

const gradeAll = (tonesRight: (engine: string) => boolean): Grades => ({
  grades: items.flatMap(({ id }) =>
    Object.entries(key[id] ?? {}).map(([label, engine]) => ({
      item: id,
      label: label as "A" | "B" | "C",
      tonesRight: tonesRight(engine),
      naturalness: engine === "melotts" ? 3 : 4,
    })),
  ),
  notes: {},
});

describe("makeKey", () => {
  it("gives every item each engine once, the same way on every run", () => {
    const full = makeKey(BAKEOFF_SET, ENGINE_IDS);
    for (const { id } of BAKEOFF_SET) {
      expect(Object.values(full[id] ?? {}).sort()).toEqual([...ENGINE_IDS].sort());
    }
    expect(makeKey(BAKEOFF_SET, ENGINE_IDS)).toEqual(full);
    expect(new Set(BAKEOFF_SET.map(({ id }) => full[id]?.A)).size).toBe(3);
  });
});

describe("reveal", () => {
  it("names the engine behind each label", () => {
    const revealed = reveal(
      items,
      key,
      gradeAll((engine) => engine !== "melotts"),
    );
    expect(
      revealed.ok &&
        revealed.value.filter(({ tonesRight }) => !tonesRight).map(({ engine }) => engine),
    ).toEqual(["melotts", "melotts"]);
  });

  it("refuses an incomplete grading", () => {
    const grades = gradeAll(() => true);
    const result = reveal(items, key, { ...grades, grades: grades.grades.slice(1) });
    expect(!result.ok && result.error).toBe("1 of 6 samples are not graded yet");
  });

  it("refuses unknown and duplicated samples", () => {
    const grades = gradeAll(() => true);
    const first = grades.grades[0] ?? null;
    if (first === null) throw new Error("no grade");
    expect(reveal(items, key, { ...grades, grades: [...grades.grades, first] }).ok).toBe(false);
    expect(reveal(items, key, { ...grades, grades: [{ ...first, item: "nope" }] }).ok).toBe(false);
  });
});

describe("formatReport", () => {
  it("tabulates tones and naturalness per engine and category", () => {
    const revealed = reveal(
      items,
      key,
      gradeAll((engine) => engine !== "melotts"),
    );
    if (!revealed.ok) throw new Error(revealed.error);
    const report = formatReport(items, ENGINE_IDS, revealed.value);
    expect(report).toContain("| melotts | 0 % (0/2) | 3.00 |");
    expect(report).toContain("| cosyvoice3 | 100 % (2/2) | 4.00 |");
    expect(report).toContain("| third-tone | 0 % (0/1) | 100 % (1/1) | 100 % (1/1) |");
  });
});
