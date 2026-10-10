/** Each character over its syllable, or the whole word over every syllable when they do not line up. */
export const rubyPairs = <Syllable>(
  word: string,
  syllables: readonly Syllable[],
): readonly (readonly [string, readonly Syllable[]])[] => {
  const characters = Array.from(word);
  return characters.length === syllables.length
    ? characters.map((character, index) => [character, syllables.slice(index, index + 1)] as const)
    : [[word, syllables]];
};
