import { describe, expect, it } from "vitest";
import { proficiencyFrameworks, type LanguagePack } from "../language-pack.ts";

export type ContractFixture = {
  readonly knownTerm: string;
  readonly unknownTerm: string;
  readonly sampleText: string;
};

export const describeLanguagePackContract = (
  createPack: () => LanguagePack,
  fixture: ContractFixture,
): void => {
  const pack = createPack();

  describe(`LanguagePack contract: ${pack.id}`, () => {
    it("declares every feature as an implementation or null", () => {
      for (const feature of Object.values(pack.features)) {
        expect(feature === null || typeof feature === "object").toBe(true);
      }
    });

    it("returns no token for empty text", () => {
      expect(pack.tokenize("")).toEqual([]);
    });

    it("covers the text with contiguous tokens", () => {
      const tokens = pack.tokenize(fixture.sampleText);
      let offset = 0;
      for (const token of tokens) {
        expect(token.start).toBe(offset);
        expect(fixture.sampleText.slice(token.start, token.end)).toBe(token.text);
        offset = token.end;
      }
      expect(offset).toBe(fixture.sampleText.length);
      expect(tokens.some((token) => token.isWord)).toBe(true);
    });

    it("tokenizes deterministically", () => {
      expect(pack.tokenize(fixture.sampleText)).toEqual(pack.tokenize(fixture.sampleText));
    });

    it("finds the known term", async () => {
      const result = await pack.lookup(fixture.knownTerm);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(
        result.value.some(
          (entry) =>
            entry.headword === fixture.knownTerm || entry.variants.includes(fixture.knownTerm),
        ),
      ).toBe(true);
    });

    it("returns an empty list for an unknown term", async () => {
      expect(await pack.lookup(fixture.unknownTerm)).toEqual({ ok: true, value: [] });
    });

    it("returns entries with glosses and a level inside the framework", async () => {
      const result = await pack.lookup(fixture.knownTerm);
      if (!result.ok) throw new Error(`lookup failed: ${result.error.kind}`);
      const levelCount = proficiencyFrameworks[pack.proficiency].length;
      for (const entry of result.value) {
        expect(entry.glosses.length).toBeGreaterThan(0);
        if (entry.level !== null) {
          expect(Number.isInteger(entry.level)).toBe(true);
          expect(entry.level).toBeGreaterThanOrEqual(1);
          expect(entry.level).toBeLessThanOrEqual(levelCount);
        }
      }
    });
  });
};
