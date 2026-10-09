import { inMemoryDictionary, type DictEntry } from "@openlinguo/core";
import { describeLanguagePackContract } from "@openlinguo/core/testing";
import { createEnPack } from "./index.ts";

const fixture: readonly DictEntry[] = [
  {
    headword: "hello",
    variants: [],
    reading: null,
    glosses: [
      { lang: "en", text: "used as a greeting" },
      { lang: "fr", text: "bonjour" },
    ],
    level: null,
  },
  {
    headword: "world",
    variants: [],
    reading: null,
    glosses: [{ lang: "fr", text: "monde" }],
    level: null,
  },
];

describeLanguagePackContract(() => createEnPack(inMemoryDictionary(fixture)), {
  knownTerm: "hello",
  unknownTerm: "qwxz",
  sampleText: "Hello, world! I don't know.",
});
