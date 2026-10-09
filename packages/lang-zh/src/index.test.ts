import { inMemoryDictionary, type DictEntry } from "@openlinguo/core";
import { describeLanguagePackContract } from "@openlinguo/core/testing";
import { createZhPack } from "./index.ts";

const fixture: readonly DictEntry[] = [
  {
    headword: "电话",
    variants: ["電話"],
    reading: "dian4 hua4",
    glosses: [
      { lang: "en", text: "telephone" },
      { lang: "fr", text: "téléphone" },
    ],
    level: null,
  },
];

describeLanguagePackContract(() => createZhPack(inMemoryDictionary(fixture)), {
  knownTerm: "电话",
  unknownTerm: "龘",
  sampleText: "我想打电话给你。",
});
