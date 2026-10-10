import type { Gloss } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { groupGlosses, summarizeGlosses } from "./gloss-summary.ts";

const glosses: Gloss[] = [
  { lang: "en", text: "telephone", source: "cc-cedict" },
  { lang: "en", text: "CL:部[bu4]", source: "cc-cedict" },
  { lang: "en", text: "phone call", source: "cc-cedict" },
  { lang: "fr", text: "téléphone", source: "cfdict" },
  { lang: "fr", text: "Téléphone.", source: "wiktionary-fr" },
  { lang: "fr", text: "appel téléphonique", source: "wiktionary-fr" },
];

describe("summarizeGlosses", () => {
  it("gives the glosses of the first language, without classifiers or repeats", () => {
    expect(summarizeGlosses(glosses, ["fr", "en"])).toEqual({
      lang: "fr",
      texts: ["téléphone", "appel téléphonique"],
    });
    expect(summarizeGlosses(glosses, ["en", "fr"])).toEqual({
      lang: "en",
      texts: ["telephone", "phone call"],
    });
  });

  it("falls back to the next language, or to nothing", () => {
    const french = glosses.filter((gloss) => gloss.lang === "fr");
    expect(summarizeGlosses(french, ["en", "fr"])?.lang).toBe("fr");
    const classifier: Gloss = { lang: "en", text: "CL:部[bu4]", source: "cc-cedict" };
    expect(summarizeGlosses([classifier], ["en", "fr"])).toBeNull();
  });
});

describe("groupGlosses", () => {
  it("groups by source, the interface language first, without classifiers", () => {
    expect(groupGlosses(glosses, "fr")).toEqual([
      { source: "cfdict", lang: "fr", texts: ["téléphone"] },
      { source: "wiktionary-fr", lang: "fr", texts: ["Téléphone.", "appel téléphonique"] },
      { source: "cc-cedict", lang: "en", texts: ["telephone", "phone call"] },
    ]);
    expect(groupGlosses(glosses, "en").map((group) => group.source)).toEqual([
      "cc-cedict",
      "cfdict",
      "wiktionary-fr",
    ]);
  });
});
