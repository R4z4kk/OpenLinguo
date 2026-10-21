import { describe, expect, it } from "vitest";
import { proficiencyFrameworks, type LanguagePack } from "../language-pack.ts";

export type ContractFixture = {
  readonly knownTerm: string;
  readonly unknownTerm: string;
  readonly sampleText: string;
  /** The known term as typed through the pack's input method, `null` without the `ime` feature. */
  readonly typedTerm: string | null;
  /** The known term's reading as an AI writes it, `null` without prompts. */
  readonly readTerm: string | null;
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

    it("decomposes the known term from its own form, when the feature exists", async () => {
      const { decomposition } = pack.features;
      if (decomposition === null) return;
      const tree = await decomposition.decompose(fixture.knownTerm);
      expect(tree.ok && tree.value.form).toBe(fixture.knownTerm);
    });

    it("reads the strokes of the known term's first character, when the feature exists", async () => {
      const { strokes } = pack.features;
      if (strokes === null) return;
      const [first = ""] = Array.from(fixture.knownTerm);
      const data = await strokes.strokesOf(first);
      expect(data.ok).toBe(true);
      if (!data.ok || data.value === null) return;
      expect(data.value.medians).toHaveLength(data.value.strokes.length);
    });

    it("has an input method exactly when the fixture types the known term", () => {
      expect(pack.features.ime === null).toBe(fixture.typedTerm === null);
    });

    it("offers the known term for all of its typed form, when the feature exists", async () => {
      const { ime } = pack.features;
      if (ime === null || fixture.typedTerm === null) return;
      const candidates = await ime.candidates(fixture.typedTerm);
      expect(
        candidates.ok && candidates.value.find(({ text }) => text === fixture.knownTerm),
      ).toEqual({ text: fixture.knownTerm, consumed: fixture.typedTerm.length });
    });

    it("answers empty input with an error, not an empty list, when the feature exists", async () => {
      const { ime } = pack.features;
      if (ime === null) return;
      expect(await ime.candidates("")).toMatchObject({ ok: false });
    });

    it("annotates the tokens the tokenizer cuts, when the feature exists", async () => {
      const { textReading } = pack.features;
      if (textReading === null) return;
      const cut = ({ text, start, end }: { text: string; start: number; end: number }) => ({
        text,
        start,
        end,
      });
      const annotated = await textReading.annotate(fixture.sampleText);
      expect(annotated.ok && annotated.value.map(cut)).toEqual(
        pack.tokenize(fixture.sampleText).map(cut),
      );
      expect(await textReading.annotate("")).toEqual({ ok: true, value: [] });
    });

    it("gives the known term its readings and a pinyin per token, when the feature exists", async () => {
      const { textReading } = pack.features;
      if (textReading === null) return;
      const annotated = await textReading.annotate(fixture.sampleText);
      if (!annotated.ok) throw new Error(`annotate failed: ${annotated.error.kind}`);
      const term = annotated.value.find(({ text }) => text === fixture.knownTerm);
      expect(term?.isWord).toBe(true);
      expect(term?.readings.length).toBeGreaterThan(0);
      expect(term?.ambiguous).toBe((term?.readings.length ?? 0) > 1);
      const pinyin = textReading.pinyin(annotated.value);
      expect(pinyin.ok && pinyin.value).toHaveLength(annotated.value.length);
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

    it("has prompts exactly when the fixture reads the known term", () => {
      expect(pack.prompts === null).toBe(fixture.readTerm === null);
    });

    it("gives each prompt its own versioned id, when the pack has prompts", () => {
      const { prompts } = pack;
      if (prompts === null) return;
      const ids = [
        prompts.correction.id,
        prompts.vocabulary.id,
        prompts.glossTranslation.id,
        prompts.explanation.id,
        prompts.story.id,
      ];
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(id.startsWith(`${pack.id}-`)).toBe(true);
        expect(id).toMatch(/^[a-z-]+-v\d+$/u);
      }
    });

    it("sends instructions as system and the learner's text as user, when the pack has prompts", () => {
      const { prompts } = pack;
      if (prompts === null) return;
      const all = [
        prompts.correction.messages({
          word: fixture.knownTerm,
          sentences: [fixture.sampleText],
          language: "fr",
        }),
        prompts.vocabulary.messages({ themes: ["food"], note: "", level: 1, count: 5 }),
        prompts.glossTranslation.messages({
          headword: fixture.knownTerm,
          reading: fixture.readTerm ?? "",
          glosses: ["a sense"],
        }),
        prompts.explanation.messages({
          sequences: [{ sequence: fixture.unknownTerm, sentence: fixture.sampleText }],
          language: "en",
        }),
        prompts.story.messages({
          band: 1,
          theme: "food",
          length: "short",
          words: [fixture.knownTerm],
        }),
      ];
      for (const messages of all) {
        expect(messages.map(({ role }) => role)).toEqual(["system", "user"]);
      }
      expect(all[0]?.at(-1)?.content).toContain(fixture.sampleText);
    });

    it("rejects a correction with a sentence too many, when the pack has prompts", () => {
      const { prompts } = pack;
      if (prompts === null) return;
      const schema = prompts.correction.schema({
        word: null,
        sentences: [fixture.sampleText],
        language: "en",
      });
      const sentence = {
        index: 1,
        corrected: fixture.sampleText,
        changes: [],
        reading: fixture.readTerm,
        meaning: "a meaning",
      };
      expect(schema.safeParse({ sentences: [sentence] }).success).toBe(true);
      expect(schema.safeParse({ sentences: [sentence, sentence] }).success).toBe(false);
    });

    it("finds no mismatch in the known term's reading, when the pack has prompts", async () => {
      const { prompts } = pack;
      if (prompts === null || fixture.readTerm === null) return;
      expect(await prompts.checkReading(fixture.knownTerm, fixture.readTerm)).toEqual({
        ok: true,
        value: [],
      });
    });
  });
};
