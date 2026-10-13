import { describe, expect, it } from "vitest";
import { checkPicks, formatReport, type Picks } from "./bakeoff-report.ts";
import { BAKEOFF_SET } from "./bakeoff-set.ts";
import { ENGINE_IDS } from "./engines.ts";

const picks: Picks = {
  picks: { ma1: "moss-tts", ma2: "moss-tts", nihao: "moss-tts", yige: "none" },
  notes: { yige: "all read yī gè" },
};

describe("checkPicks", () => {
  it("counts the items with a pick", () => {
    expect(checkPicks(BAKEOFF_SET, picks)).toEqual({ ok: true, value: 4 });
  });

  it("refuses unknown items and an empty listening", () => {
    expect(checkPicks(BAKEOFF_SET, { picks: { nope: "moss-tts" }, notes: {} }).ok).toBe(false);
    expect(checkPicks(BAKEOFF_SET, { picks: {}, notes: {} }).ok).toBe(false);
  });
});

describe("formatReport", () => {
  it("counts the best versions per engine, overall and per listened category", () => {
    const report = formatReport(BAKEOFF_SET, ENGINE_IDS, picks);
    expect(report).toContain("| Best version | moss-tts | none |");
    expect(report).toContain("| all (4 items) | 3 | 1 |");
    expect(report).toContain("| syllable | 2 | 0 |");
    expect(report).toContain("| yi | 0 | 1 |");
    expect(report).not.toContain("| erhua |");
  });
});
