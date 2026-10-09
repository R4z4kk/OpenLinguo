import { err, ok } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import type { ShardReader } from "../run.ts";
import { cfdict, parseCfdict, repairCfdictBytes } from "./cfdict.ts";

const header = (count: string): string =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!--",
    "# CFDICT",
    "# - Version : 14/12/2024 02:30 ",
    `# - Nombre de traductions : environ ${count}`,
    "//-->",
    "<dic>",
  ].join("\r\n");

const word = (id: string, simplified: string, reading: string, glosses: readonly string[]) =>
  [
    "<word>",
    `\t<id>${id}</id>`,
    "\t<upd>1700000000</upd>",
    `\t<trad>${simplified}</trad>`,
    `\t<simp>${simplified}</simp>`,
    `\t<py>${reading}</py>`,
    "\t<trans>",
    ...glosses.map((gloss) => `\t\t<fr><![CDATA[${gloss}]]></fr>`),
    "\t</trans>",
    "</word>",
  ].join("\r\n");

const document = (count: string, words: readonly string[]): string =>
  [header(count), ...words, "</dic>"].join("\r\n");

const words = [
  word("1", "电话", "dian4 hua4", ["téléphone"]),
  word("2", "绿", "lu:4", ["vert"]),
  word("3", "电话", "dian4 hua4", ["appel", "téléphone"]),
  word("4", "一万", "yi1 wan4", ["dix mille"]),
  word("5", "丆", "xx5", ["(caractère rare)"]),
];

const cedict: ShardReader = () =>
  Promise.resolve(
    ok([
      JSON.stringify([
        ["电话", "電話", "dian4 hua4", ["telephone"]],
        ["绿", "綠", "lu:4", ["green"]],
      ]),
    ]),
  );

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("repairCfdictBytes", () => {
  it("removes a stray 0xC2 lead byte and restores the broken check mark", () => {
    const raw = Uint8Array.from([
      ...encode("<id>7</id>s"),
      0xc2,
      ...encode("'exécuter coche ("),
      0xe2,
      0x6f,
      0x65,
      0x93,
      ...encode(")"),
    ]);
    expect(repairCfdictBytes(raw)).toEqual(
      ok({
        xml: "<id>7</id>s'exécuter coche (✓)",
        repairs: [
          { entryId: "7", description: "stray 0xC2 byte removed" },
          { entryId: "7", description: "broken check mark restored" },
        ],
      }),
    );
  });

  it("fails on any other invalid byte", () => {
    const result = repairCfdictBytes(Uint8Array.from([...encode("<id>9</id>a"), 0xff, 0x41]));
    expect(result.ok || result.error).toContain("invalid UTF-8 at byte 11 (entry 9)");
  });
});

describe("parseCfdict", () => {
  it("parses entries and the header version", () => {
    const release = parseCfdict(document("5", words));
    expect(release.ok && release.value.version).toBe("2024-12-14T02:30");
    expect(release.ok && release.value.entries.map((entry) => entry.reading)).toEqual([
      "dian4 hua4",
      "lu:4",
      "dian4 hua4",
      "yi1 wan4",
      "xx5",
    ]);
  });

  it("removes empty glosses and records the repair", () => {
    const release = parseCfdict(document("1", [word("8", "放", "fang4", ["lancer", "", "x"])]));
    expect(release.ok && release.value.entries[0]?.glosses).toEqual(["lancer", "x"]);
    expect(release.ok && release.value.repairs).toEqual([
      { entryId: "8", description: "empty French gloss removed" },
    ]);
  });

  it("rejects an entry without any gloss", () => {
    expect(parseCfdict(document("1", [word("8", "放", "fang4", [""])]))).toEqual(
      err("1 malformed entries (8)"),
    );
  });

  it("rejects a block missing a field", () => {
    const broken = word("9", "电", "dian4", ["électricité"]).replace("\t<trad>电</trad>\r\n", "");
    expect(parseCfdict(document("1", [broken]))).toEqual(err("1 malformed entries (#1)"));
  });

  it("rejects an entry count far from the announced one", () => {
    expect(parseCfdict(document("56 300", words)).ok).toBe(false);
  });

  it("rejects content outside word blocks", () => {
    expect(parseCfdict(document("5", [...words, "<note/>"])).ok).toBe(false);
  });

  it("rejects an entry updated after the header version", () => {
    const late = word("6", "电", "dian4", ["électricité"]).replace("1700000000", "1800000000");
    expect(parseCfdict(document("1", [late])).ok).toBe(false);
  });
});

describe("cfdict dataset", () => {
  it("joins French glosses to CC-CEDICT keys and lists the rest", async () => {
    const built = await cfdict.build(encode(document("5", words)), cedict);
    if (!built.ok) throw new Error(built.error);
    expect(built.value.files.get("entries-000.json")).toBe(
      '[\n["电话","dian4 hua4",["téléphone","appel"]],\n["绿","lu:4",["vert"]]\n]\n',
    );
    expect(built.value.files.get("unmatched.tsv")).toBe(
      "simplified\ttraditional\tpinyin\treason\n一万\t一万\tyi1 wan4\tno-cc-cedict-entry\n丆\t丆\txx5\tinvalid-reading\n",
    );
    expect(built.value.summary).toBe(
      "5 entries, 2 keys joined to CC-CEDICT, 2 unmatched, 0 repairs",
    );
  });

  it("requires cc-cedict to be built first", async () => {
    const built = await cfdict.build(encode(document("5", words)), () => Promise.resolve(ok([])));
    expect(built).toEqual(err("cc-cedict must be built before cfdict"));
  });
});
