import { describe, expect, it } from "vitest";
import { fold, glossPhrase, indexedWords } from "./search-keys.ts";

describe("fold", () => {
  it("lowercases and drops accents and ligatures", () => {
    expect(fold("Œuvre d’Été")).toBe("oeuvre d'ete");
  });
});

describe("indexedWords", () => {
  it("keeps Latin words, without stop words or bracketed pinyin", () => {
    expect(indexedWords("variant of 電話|电话[dian4 hua4]")).toEqual(["variant"]);
    expect(indexedWords("to make a phone call (to sb)")).toEqual(["make", "phone", "call", "sb"]);
    expect(indexedWords("le téléphone de l'école")).toEqual(["telephone", "ecole"]);
    expect(indexedWords("CL:部[bu4]")).toEqual(["cl"]);
  });
});

describe("glossPhrase", () => {
  it("compares glosses without case, accents, parentheses or a leading to", () => {
    expect(glossPhrase("to call (sb)")).toBe("call");
    expect(glossPhrase("To Call")).toBe("call");
    expect(glossPhrase("Téléphone")).toBe("telephone");
    expect(glossPhrase("phone call")).toBe("phone call");
  });
});
