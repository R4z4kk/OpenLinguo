import { gzipSync } from "node:zlib";
import { err, ok } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import type { ShardReader } from "../run.ts";
import { parseWiktionary, wiktionaryFrZh } from "./wiktionary-fr-zh.ts";

const pinyin = (zhPron: string) => ({ zh_pron: zhPron, tags: ["Mandarin", "Pinyin"] });
const simplified = (form: string) => ({ form, tags: ["Simplified-Chinese"] });
const traditional = (form: string) => ({ form, tags: ["Traditional-Chinese"] });

const line = (
  word: string,
  sounds: readonly object[],
  glosses: readonly string[],
  extra: object = {},
): string =>
  JSON.stringify({
    word,
    lang_code: "zh",
    lang: "Chinois",
    pos: "noun",
    sounds,
    senses: glosses.map((gloss) => ({ glosses: [gloss], id: `fr-${word}` })),
    ...extra,
  });

const lines = [
  line("星期", [pinyin("xīngqī")], ["Semaine."]),
  line("電話", [pinyin("diànhuà")], ["Téléphone."], { forms: [simplified("电话")] }),
  line("地", [pinyin("dì"), pinyin("dì (di⁴), de (de⁵)")], ["Sol."]),
  line("维基字典", [pinyin("wéijī zìdiǎn")], ["Wiktionnaire."], {
    forms: [traditional("維基字典")],
  }),
  line("公民", [], ["Citoyen."]),
  line("1月", [pinyin("yīyuè")], ["Janvier."]),
  line("太阳", [pinyin("taìyáng")], ["Soleil."]),
  line("架", [pinyin("jià")], ["* Classificateur\n#* 一架钢琴"]),
  line("人", [pinyin("rén")], ["(2 traits, radical 9)"], { pos: "character" }),
  line("星", [pinyin("xīng")], [], { senses: [{ tags: ["no-gloss"] }] }),
];

const cedict: ShardReader = () =>
  Promise.resolve(
    ok([
      JSON.stringify([
        ["星期", "星期", "xing1 qi1", ["week"]],
        ["电话", "電話", "dian4 hua4", ["telephone"]],
        ["地", "地", "di4", ["earth"]],
        ["地", "地", "de5", ["-ly"]],
      ]),
    ]),
  );

const gzip = (text: string): Uint8Array => gzipSync(new TextEncoder().encode(text));

describe("parseWiktionary", () => {
  it("keeps a traditional title when its simplified form is ambiguous", () => {
    const release = parseWiktionary(
      line("發", [pinyin("fā")], ["Émettre."], { forms: [simplified("発"), simplified("发")] }),
    );
    expect(release.ok && release.value.entries[0]?.simplified).toBe("發");
  });

  it("rejects malformed lines and other languages", () => {
    const japanese = line("月", [pinyin("yuè")], ["Lune."], { lang_code: "ja" });
    expect(parseWiktionary(`${lines[0] ?? ""}\n{oops\n${japanese}\n`)).toEqual(
      err("2 malformed lines (2, 3)"),
    );
  });
});

describe("wiktionary-fr-zh dataset", () => {
  it("joins the first reading to CC-CEDICT and lists every left-out entry", async () => {
    const built = await wiktionaryFrZh.build(gzip(`${lines.join("\n")}\n`), cedict);
    if (!built.ok) throw new Error(built.error);
    expect(built.value.files.get("glosses-000.json")).toBe(
      '[\n["星期","xing1 qi1",["Semaine."]],\n["电话","dian4 hua4",["Téléphone."]],\n["地","di4",["Sol."]]\n]\n',
    );
    expect(built.value.files.get("entries-000.json")).toBe(
      '[\n["维基字典","維基字典","wei2 ji1 zi4 dian3",["Wiktionnaire."]]\n]\n',
    );
    expect(built.value.files.get("issues.tsv")).toBe(
      [
        "title\tissue\tdetail",
        "地\tseveral-readings\tdì | de",
        "公民\tno-pinyin\t",
        "1月\tnon-han-title\t",
        "太阳\tinvalid-reading\ttaìyáng",
        "架\tmultiline-gloss\t* Classificateur #* 一架钢琴",
        "",
      ].join("\n"),
    );
    expect(built.value.version).toMatch(/^sha256 [0-9a-f]{12}$/u);
    expect(built.value.summary).toBe(
      "4 entries imported (1 sinogram and 1 unglossed entries skipped), 3 CC-CEDICT keys glossed (3 exact, 0 via traditional form, 0 neutral-tone, 0 tone conflicts), 1 French-only entries (0 ambiguous), 0 rejected, issues: 1 several-readings, 1 no-pinyin, 1 non-han-title, 1 invalid-reading, 1 multiline-gloss",
    );
  });

  it("rejects bytes that are not gzip", async () => {
    const built = await wiktionaryFrZh.build(new TextEncoder().encode(lines[0] ?? ""), cedict);
    expect(built.ok || built.error).toContain("cannot decompress");
  });

  it("requires cc-cedict to be built first", async () => {
    const built = await wiktionaryFrZh.build(gzip(lines[0] ?? ""), () => Promise.resolve(ok([])));
    expect(built).toEqual(err("cc-cedict must be built before wiktionary-fr-zh"));
  });
});
