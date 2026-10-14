import { applySandhi, parseNumbered } from "@openlinguo/lang-zh";

/** One syllable to answer on: its letters without tone, its citation tone (5 is neutral). */
export type ToneSyllable = { readonly letters: string; readonly tone: number };

/** The syllables said, the erhua suffix `r5` being said inside the one before it. */
const syllablesOf = (reading: string): readonly ToneSyllable[] | null => {
  const tokens = parseNumbered(reading);
  if (!tokens.ok) return null;
  return tokens.value.flatMap((token, index) =>
    token.kind === "syllable" && !(index > 0 && token.letters.toLowerCase() === "r")
      ? [{ letters: token.letters, tone: token.tone }]
      : [],
  );
};

/** The syllables of a reading with at least one tone to hear, `null` when it has none or is invalid. */
export const toneSyllables = (readingKey: string): readonly ToneSyllable[] | null => {
  const syllables = syllablesOf(readingKey);
  return syllables !== null && syllables.some(({ tone }) => tone !== 5) ? syllables : null;
};

/**
 * The reading as spoken after sandhi, with its tones; the citation reading when sandhi cannot be
 * applied to the word (a one or not written with an unaligned reading).
 */
export const spokenReading = (
  headword: string,
  readingKey: string,
): { readonly reading: string; readonly tones: readonly number[] } | null => {
  const citation = syllablesOf(readingKey);
  if (citation === null) return null;
  const spoken = applySandhi([{ text: headword, reading: readingKey }]);
  const reading = spoken.ok ? (spoken.value[0] ?? readingKey) : readingKey;
  const tones = syllablesOf(reading)?.map(({ tone }) => tone) ?? [];
  return tones.length === citation.length
    ? { reading, tones }
    : { reading: readingKey, tones: citation.map(({ tone }) => tone) };
};
