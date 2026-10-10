import { describe, expect, it } from "vitest";
import type { CharacterRow, EntryRow } from "../data/format.ts";
import {
  GAP_TABLES,
  gapCounts,
  gapReport,
  parseReviewCounts,
  parseTable,
  renderReport,
  reviewBody,
  type GapSources,
  type Table,
} from "./gaps.ts";

const HEADERS: Readonly<Record<string, string>> = {
  "cfdict/tone-conflicts.tsv": "entry_id\tsimplified\tcfdict_pinyin\tcc_cedict_pinyin",
  "wiktionary-fr-zh/tone-conflicts.tsv": "title\tsimplified\twiktionary_pinyin\tcc_cedict_pinyin",
  "wiktionary-fr-zh/issues.tsv": "title\tissue\tdetail",
  "cfdict/rejected.tsv": "entry_id\tsimplified\tpinyin",
  "hsk-2025-words/issues.tsv": "word\tsyllabus_pinyin\tcc_cedict_readings\tissue",
  "gf0025-2021-words/issues.tsv": "word\tcc_cedict_readings\tissue",
  "font-noto-sans-sc-400/missing.tsv": "character",
  "font-noto-sans-sc-700/missing.tsv": "character",
  "font-lxgw-wenkai-gb/missing.tsv": "character",
  "hanzi-writer-data/missing.tsv": "character",
  "cfdict/repairs.tsv": "entry_id\trepair",
  "gf0025-2021-chars/repairs.tsv": "section\tline\trepair",
  "gf0025-2021-words/repairs.tsv": "section\tline\trepair",
};

const tables = (rows: Readonly<Record<string, string>>): ReadonlyMap<string, Table> =>
  new Map(
    GAP_TABLES.map((path) => [path, parseTable(`${HEADERS[path] ?? ""}\n${rows[path] ?? ""}`)]),
  );

const entry = (
  simplified: string,
  reading: string,
  glosses: EntryRow[4],
  hsk: number | null,
  gf: number | null,
  zipf: number | null,
  variants: string[] = [],
): EntryRow => [simplified, reading, reading, variants, glosses, hsk, gf, true, zipf];

const characters: CharacterRow[] = [
  ["好", "⿰女子", "女", null],
  ["⺀", "？", "⺀", null],
  ["卜", "⿰丨？", "卜", null],
];

const sources: GapSources = {
  entries: [
    entry("好玩儿", "hao3 wan2 r5", [["fun"], [], []], 1, null, 3.1),
    entry("面条儿", "mian4 tiao2 r5", [["noodles"], [], []], 1, null, 3.6),
    entry("检票", "jian3 piao4", [["to check tickets"], [], []], null, 4, 2.5),
    entry("语", "yu3", [["language"], ["langue"], []], 3, null, 5, ["語"]),
    entry("某某", "mou3 mou3", [["so-and-so"], [], []], null, null, 3),
    entry("天啊", "tian1 a5", [[], ["Mon Dieu !"], []], null, null, null),
  ],
  wordLevels: new Map([
    ["好玩儿", 1],
    ["语", 3],
  ]),
  characterLevels: new Map([
    ["好", 1],
    ["卜", 7],
  ]),
  characters,
  tables: tables({
    "cfdict/tone-conflicts.tsv": "1\t语\tyu4\tyu3\n2\t天天\ttian1 tian1\ttian2 tian1",
    "wiktionary-fr-zh/issues.tsv":
      "語\tseveral-readings\tyǔ | yù\n語\tseveral-readings\tyǔ\nxx\tno-pinyin\t",
    "cfdict/repairs.tsv": "63314\tstray 0xC2 byte removed",
  }),
};

describe("parseTable", () => {
  it("splits the header and the non-empty rows", () => {
    expect(parseTable("word\tissue\n吧\tabsent\n\n")).toEqual({
      header: ["word", "issue"],
      rows: [["吧", "absent"]],
    });
  });
});

describe("gapReport", () => {
  const built = gapReport(sources);
  if (!built.ok) throw new Error(built.error);
  const { categories, files } = built.value;
  const list = (title: string, label: string) =>
    categories
      .find((category) => category.title === title)
      ?.lists.find((candidate) => candidate.label === label) ?? null;

  it("lists graded words without French by HSK band, GF0025 level, then frequency", () => {
    expect(files.get("gaps/missing-french.tsv")).toBe(
      [
        "simplified\treading\thsk_2025\tgf0025_2021\tzipf",
        "面条儿\tmian4 tiao2 r5\t1\t\t3.6",
        "好玩儿\thao3 wan2 r5\t1\t\t3.1",
        "检票\tjian3 piao4\t\t4\t2.5",
        "",
      ].join("\n"),
    );
    expect(list("Missing French translation", "All CC-CEDICT entries")?.total).toBe(4);
  });

  it("places traditional forms in the band of their simplified word", () => {
    expect(list("Doubtful translation", "Wiktionary entries with several readings")?.gaps).toEqual([
      { item: "語", band: 3 },
      { item: "語", band: 3 },
    ]);
    expect(list("Rejected or invalid source entries", "Wiktionary entries without pinyin")).toEqual(
      {
        label: "Wiktionary entries without pinyin",
        path: "wiktionary-fr-zh/issues.tsv",
        unit: "word",
        gaps: [{ item: "xx", band: null }],
        total: 1,
      },
    );
  });

  it("lists decompositions with an unknown component, HSK characters first", () => {
    expect(files.get("gaps/unknown-components.tsv")).toBe(
      "character\tdecomposition\thsk_2025\n卜\t⿰丨？\t7-9\n⺀\t？\t\n",
    );
  });

  it("counts lists whose rows name no word or character without bands", () => {
    expect(list("Repairs applied to a source", "CFDICT")).toMatchObject({
      unit: "row",
      gaps: [],
      total: 1,
    });
  });

  it("renders counts per band, dashes for unbanded lists, and each HSK item once", () => {
    const report = renderReport(categories);
    expect(report).toContain(
      "| [CFDICT tone conflicts](cfdict/tone-conflicts.tsv) | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 2 |",
    );
    expect(report).toContain(
      "| [CFDICT](cfdict/repairs.tsv) | — | — | — | — | — | — | — | — | 1 |",
    );
    expect(report).toContain(
      "- [Wiktionary entries with several readings](wiktionary-fr-zh/issues.tsv): 1 HSK words: 語 (HSK 3).",
    );
  });

  it("refuses an issue no list counts, and a missing column", () => {
    expect(
      gapReport({
        ...sources,
        tables: tables({ "wiktionary-fr-zh/issues.tsv": "語\tnew-kind\t" }),
      }),
    ).toEqual({
      ok: false,
      error: "data/wiktionary-fr-zh/issues.tsv has unclassified issues: new-kind",
    });
    const renamed = new Map(sources.tables);
    renamed.set("cfdict/rejected.tsv", parseTable("entry_id\tword\tpinyin\n"));
    expect(gapReport({ ...sources, tables: renamed })).toEqual({
      ok: false,
      error: 'data/cfdict/rejected.tsv has no "simplified" column',
    });
  });
});

describe("review issue", () => {
  const counts = { "Missing French translation: Graded words": { hsk: 2, total: 3 } };

  it("counts changes since the previous review and carries its counts", () => {
    const body = reviewBody(
      { ...counts, "Repairs applied to a source: CFDICT": { hsk: null, total: 46 } },
      {
        "Missing French translation: Graded words": { hsk: 4, total: 3 },
        "Old list": { hsk: 1, total: 1 },
      },
      "https://github.com/R4z4kk/OpenLinguo/blob/main/data/GAPS.md",
    );
    expect(body).toContain("| Missing French translation: Graded words | 2 | −2 | 3 | 0 |");
    expect(body).toContain("| Repairs applied to a source: CFDICT | — | new | 46 | new |");
    expect(body).toContain("No longer counted: Old list.");
    expect(parseReviewCounts(body)).toEqual({
      ok: true,
      value: { ...counts, "Repairs applied to a source: CFDICT": { hsk: null, total: 46 } },
    });
  });

  it("says when it is the first review", () => {
    expect(reviewBody(counts, null, "url")).toContain("This is the first review.");
  });

  it("refuses a previous body without valid counts", () => {
    expect(parseReviewCounts("no block").ok).toBe(false);
    expect(parseReviewCounts("<!-- gap-counts {oops} -->").ok).toBe(false);
    expect(parseReviewCounts('<!-- gap-counts {"a":{"total":"1"}} -->').ok).toBe(false);
  });

  it("keys counts by category and list", () => {
    const built = gapReport(sources);
    if (!built.ok) throw new Error(built.error);
    expect(
      gapCounts(built.value.categories)["Missing French translation: All CC-CEDICT entries"],
    ).toEqual({
      hsk: 2,
      total: 4,
    });
  });
});
