import { toSimplified } from "./transcript.ts";

const HAN = /\p{Script=Han}/u;

/**
 * Share of Han characters opencc-js changes to simplified: 0 % in simplified text, 5 % with a quoted
 * traditional phrase, 25–48 % in traditional text (2026-10-21, tw → cn on short samples).
 */
const TRADITIONAL_SHARE = 0.1;

export type TraditionalCount = { readonly traditional: number; readonly han: number };

/** The Han characters of `text`, and those only traditional script writes. */
export const traditionalCharacters = (text: string): TraditionalCount => {
  const changed = new Map<string, boolean>();
  let traditional = 0;
  let han = 0;
  for (const character of text) {
    if (!HAN.test(character)) continue;
    han += 1;
    let differs = changed.get(character) ?? null;
    if (differs === null) {
      differs = toSimplified(character) !== character;
      changed.set(character, differs);
    }
    if (differs) traditional += 1;
  }
  return { traditional, han };
};

/** The text is mostly in traditional script: the reader knows simplified characters only (v1). */
export const looksTraditional = (text: string): boolean => {
  const { traditional, han } = traditionalCharacters(text);
  return han > 0 && traditional / han >= TRADITIONAL_SHARE;
};
