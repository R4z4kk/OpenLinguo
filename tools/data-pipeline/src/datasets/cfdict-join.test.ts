import { ok } from "@openlinguo/core";
import { beforeAll, describe, expect, it } from "vitest";
import { loadCedictIndex, matchEntry, type CedictIndex } from "./cfdict-join.ts";

const rows = [
  ["位于", "位於", "wei4 yu2", ["to be located at"]],
  ["一会儿", "一會兒", "yi1 hui4 r5", ["a while"]],
  ["上面", "上面", "shang4 mian4", ["on top of"]],
  ["一场空", "一場空", "yi1 chang2 kong1", ["futile"]],
  ["么", "麼", "ma5", ["interrogative particle"]],
  ["么", "麼", "me5", ["suffix"]],
  ["中", "中", "zhong1", ["middle"]],
  ["中", "中", "zhong4", ["to hit"]],
];

let index: CedictIndex;

beforeAll(async () => {
  const loaded = await loadCedictIndex(() => Promise.resolve(ok([JSON.stringify(rows)])));
  if (!loaded.ok) throw new Error(loaded.error);
  index = loaded.value;
});

const via = (simplified: string, reading: string): string => {
  const outcome = matchEntry(index, simplified, reading);
  return outcome.kind === "joined" ? `${outcome.via} ${outcome.target.simplified}` : outcome.kind;
};

describe("matchEntry", () => {
  it("joins on simplified + pinyin", () => {
    expect(via("位于", "wei4 yu2")).toBe("exact 位于");
  });

  it("joins a headword CFDICT stored in its traditional form", () => {
    expect(via("位於", "wei4 yu2")).toBe("traditional-form 位于");
  });

  it("joins the toneless erhua r of CFDICT", () => {
    expect(via("一会儿", "yi1 hui4 r")).toBe("exact 一会儿");
  });

  it("joins despite a neutral-tone difference", () => {
    expect(via("上面", "shang4 mian5")).toBe("neutral-tone 上面");
  });

  it("joins a tone conflict when only one entry has the same syllables", () => {
    expect(via("一场空", "yi1 chang3 kong1")).toBe("tone-conflict 一场空");
  });

  it("keeps another reading of a known headword as a French-only entry", () => {
    expect(matchEntry(index, "么", "yao1")).toEqual({
      kind: "french-only",
      reading: "yao1",
      ambiguous: false,
    });
  });

  it("does not guess between several entries with the same syllables", () => {
    expect(matchEntry(index, "中", "zhong3")).toEqual({
      kind: "french-only",
      reading: "zhong3",
      ambiguous: true,
    });
  });

  it("rejects an invalid reading", () => {
    expect(matchEntry(index, "丆", "xx5")).toEqual({ kind: "rejected" });
  });
});
