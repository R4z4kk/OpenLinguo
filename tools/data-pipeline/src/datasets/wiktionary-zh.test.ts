import { gzipSync } from "node:zlib";
import { err, ok } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import type { ShardReader } from "../run.ts";
import { noFile } from "../testing/readers.ts";
import { parseEnglishWiktionary, wiktionaryZh } from "./wiktionary-zh.ts";

const MANDARIN = ["Mandarin", "Pinyin"];
const sound = (zhPron: string, tags: readonly string[] = MANDARIN) => ({ zh_pron: zhPron, tags });
const simplified = (form: string) => ({ form, tags: ["Simplified-Chinese"] });

const line = (word: string, sounds: readonly object[], glosses: readonly string[], extra = {}) =>
  JSON.stringify({
    word,
    lang: "Chinese",
    lang_code: "zh",
    pos: "noun",
    sounds,
    senses: glosses.map((gloss) => ({ glosses: [gloss], id: `en-${word}` })),
    ...extra,
  });

const lines = [
  line("電話", [sound("diànhuà")], ["telephone"], { forms: [simplified("电话")] }),
  line("电话", [], [], { pos: "soft-redirect", senses: [{ tags: ["no-gloss"] }] }),
  line("話", [sound("huà")], ["speech"], { pos: "character" }),
  line("熱可可", [sound("rèkěkě")], ["hot cocoa"], { forms: [simplified("热可可")] }),
  line("小明", [sound("Xiǎomíng")], ["John Doe (a placeholder name for young boys)"], {
    pos: "name",
  }),
  line("睇嚟", [sound("tai2 lai4", ["Cantonese", "Jyutping"])], ["to seem as if"], {
    pos: "verb",
  }),
  line("鼻筒", [sound("bi⁴ tong²", ["Chengdu", "Mandarin", "Pinyin", "Sichuanese"])], ["nose"]),
  line(
    "成熟期",
    [
      sound("chéngshúqí", ["Mandarin", "Pinyin", "Standard-Chinese", "Taiwan"]),
      sound("chéngshúqī", ["Mainland-China", "Mandarin", "Pinyin", "Standard-Chinese"]),
    ],
    ["maturity"],
    { forms: [simplified("成熟期")] },
  ),
  line("菊花茶", [sound("júhuāchá")], [], {
    senses: [
      { glosses: ["chrysanthemum tea"] },
      { glosses: ["chrysanthemum tea", "tea brewed from dried flowers"] },
      { glosses: ["(slang) a beer"], raw_glosses: ["(Cantonese, slang) a beer"] },
      { glosses: ["chrysanthemum tea"] },
      { tags: ["no-gloss"] },
    ],
  }),
  line("警匪片", [sound("jǐngfěipiàn"), sound("jǐngfěipiān")], ["cop film"]),
  line("我愛你", [sound("wǒ ài nǐ")], ["I love you"], {
    pos: "phrase",
    forms: [simplified("我爱你"), simplified("我爱汝")],
  }),
  line(
    "日本語",
    [sound("Rìběnyǔ [Phonetic: rìbényǔ", ["Mandarin", "Pinyin", "Standard"])],
    ["Japanese (language)"],
  ),
  line("玩兒鬧", [sound("wánrnào")], ["to joke"], { forms: [simplified("玩儿闹")] }),
  line("阿sir", [sound("ā sā")], ["sir (police officer)"]),
  line("瀨尿", [sound("lài niào")], ["to wet oneself\n#: example"], {
    forms: [simplified("濑尿")],
  }),
  line("鄰舍", [sound("línshè")], ["neighbor"], { forms: [simplified("邻舍")] }),
  line("鄰舍", [sound("línshè")], ["neighborhood", "neighbor"], {
    forms: [simplified("邻舍")],
  }),
  line("無", [sound("wú")], [], { senses: [{ tags: ["no-gloss"] }] }),
];

const cedict: ShardReader = () =>
  Promise.resolve(ok([JSON.stringify([["电话", "電話", "dian4 hua4", ["telephone"]]])]));

const headwords = new Set(["电话", "電話"]);
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("parseEnglishWiktionary", () => {
  it("keeps the words CC-CEDICT lacks, under their simplified form", () => {
    const release = parseEnglishWiktionary(bytes(lines.join("\n")), headwords);
    if (!release.ok) throw new Error(release.error);
    expect(release.value.rows).toEqual([
      ["小明", "小明", "Xiao3 ming2", "name", ["John Doe (a placeholder name for young boys)"]],
      ["成熟期", "成熟期", "cheng2 shu2 qi1", "noun", ["maturity"]],
      ["我爱你", "我愛你", "wo3 ai4 ni3", "phrase", ["I love you"]],
      ["日本語", "日本語", "Ri4 ben3 yu3", "noun", ["Japanese (language)"]],
      ["热可可", "熱可可", "re4 ke3 ke3", "noun", ["hot cocoa"]],
      [
        "菊花茶",
        "菊花茶",
        "ju2 hua1 cha2",
        "noun",
        ["chrysanthemum tea", "tea brewed from dried flowers", "(Cantonese, slang) a beer"],
      ],
      ["警匪片", "警匪片", "jing3 fei3 pian4", "noun", ["cop film"]],
      ["邻舍", "鄰舍", "lin2 she4", "noun", ["neighbor", "neighborhood"]],
    ]);
    expect(release.value.skipped).toEqual({
      sinograms: 1,
      redirects: 1,
      unglossed: 1,
      inCedict: 1,
      noStandardReading: 2,
    });
  });

  it("lists every entry left out or read with a choice", () => {
    const release = parseEnglishWiktionary(bytes(lines.join("\n")), headwords);
    expect(release.ok && release.value.issues).toEqual([
      { word: "警匪片", kind: "several-readings", detail: "jǐngfěipiàn | jǐngfěipiān" },
      { word: "我愛你", kind: "several-simplified-forms", detail: "我爱你 | 我爱汝" },
      { word: "玩兒鬧", kind: "invalid-reading", detail: "wánrnào" },
      { word: "阿sir", kind: "non-han-title", detail: "" },
      { word: "瀨尿", kind: "multiline-gloss", detail: "to wet oneself\n#: example" },
    ]);
  });

  it("rejects malformed lines, invalid UTF-8 and other languages", () => {
    const japanese = line("月", [sound("yuè")], ["moon"], { lang_code: "ja" });
    const text = bytes(`${lines[0] ?? ""}\n{oops\n${japanese}\n`);
    const invalid = new Uint8Array([...text, 0xff, 0x0a]);
    expect(parseEnglishWiktionary(invalid, headwords)).toEqual(err("3 malformed lines (2, 3, 4)"));
  });
});

describe("wiktionary-zh dataset", () => {
  it("writes the words, the issues and the payload", async () => {
    const built = await wiktionaryZh.build(gzipSync(bytes(lines.join("\n"))), cedict, noFile);
    if (!built.ok) throw new Error(built.error);
    expect(built.value.files.get("words-000.json")).toMatch(
      /^\[\n\["小明","小明","Xiao3 ming2","name",\["John Doe/u,
    );
    expect(built.value.files.get("issues.tsv")).toBe(
      [
        "title\tissue\tdetail",
        "警匪片\tseveral-readings\tjǐngfěipiàn | jǐngfěipiān",
        "我愛你\tseveral-simplified-forms\t我爱你 | 我爱汝",
        "玩兒鬧\tinvalid-reading\twánrnào",
        "阿sir\tnon-han-title\t",
        "瀨尿\tmultiline-gloss\tto wet oneself #: example",
        "",
      ].join("\n"),
    );
    expect(built.value.version).toMatch(/^sha256 [0-9a-f]{12}$/u);
    expect(built.value.summary).toBe(
      "8 words kept (1 names); skipped: 1 entries in CC-CEDICT, 2 without a Standard Mandarin reading, 1 sinogram sections, 1 soft redirects, 1 unglossed; issues: 1 several-readings, 1 several-simplified-forms, 1 invalid-reading, 1 non-han-title, 1 multiline-gloss",
    );
    expect(built.value.files.get("README.md")).toMatch(
      /- Payload: 0\.0 MB of JSON in 1 files, 0\.0 MB gzipped\.\n$/u,
    );
  });

  it("rejects bytes that are not gzip", async () => {
    const built = await wiktionaryZh.build(bytes(lines[0] ?? ""), cedict, noFile);
    expect(built.ok || built.error).toContain("cannot decompress");
  });

  it("requires cc-cedict to be built first", async () => {
    const built = await wiktionaryZh.build(
      gzipSync(bytes(lines[0] ?? "")),
      () => Promise.resolve(ok([])),
      noFile,
    );
    expect(built).toEqual(err("cc-cedict must be built before wiktionary-zh"));
  });
});
