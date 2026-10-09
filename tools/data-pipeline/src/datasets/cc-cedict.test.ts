import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ccCedict, parseCedict } from "./cc-cedict.ts";

const release = (entries: number, lines: readonly string[]): string =>
  [
    "# CC-CEDICT",
    "#! version=1",
    `#! entries=${String(entries)}`,
    "#! date=2026-10-09T09:12:50Z",
    ...lines,
  ].join("\r\n");

const sample = [
  "電話 电话 [dian4 hua4] /telephone/CL:部[bu4]/phone call/",
  "一律 一律 [yi1 lu:4] /same; identical/uniformly/",
];

describe("parseCedict", () => {
  it("parses entries as [simplified, traditional, pinyin, glosses]", () => {
    expect(parseCedict(release(2, sample))).toEqual({
      ok: true,
      value: {
        date: "2026-10-09T09:12:50Z",
        rows: [
          ["电话", "電話", "dian4 hua4", ["telephone", "CL:部[bu4]", "phone call"]],
          ["一律", "一律", "yi1 lu:4", ["same; identical", "uniformly"]],
        ],
      },
    });
  });

  it("fails when the entry count differs from the header", () => {
    expect(parseCedict(release(3, sample))).toEqual({
      ok: false,
      error: "header declares 3 entries, parsed 2",
    });
  });

  it("reports malformed lines instead of skipping them", () => {
    const result = parseCedict(release(3, [...sample, "電 电 dian4 /electric/", "a b [c] /x//y/"]));
    expect(result).toEqual({ ok: false, error: "2 malformed entries (lines 7, 8)" });
  });

  it("fails without release header", () => {
    expect(parseCedict(sample.join("\n")).ok).toBe(false);
  });
});

describe("ccCedict dataset", () => {
  it("builds shards and an attribution readme from the gzip release", () => {
    const built = ccCedict.build(gzipSync(release(2, sample)));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.version).toBe("2026-10-09T09:12:50Z");
    expect([...built.value.files.keys()]).toEqual(["entries-000.json", "README.md"]);
    expect(built.value.files.get("README.md")).toContain(
      "https://creativecommons.org/licenses/by-sa/4.0/",
    );
  });

  it("rejects bytes that are not gzip", () => {
    expect(ccCedict.build(new TextEncoder().encode("plain")).ok).toBe(false);
  });
});
