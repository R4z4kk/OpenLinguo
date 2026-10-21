import type { Token } from "@openlinguo/core";

type Segment = { readonly chars: readonly string[]; readonly known: boolean };
type Lexicon = { readonly has: (word: string) => boolean };

const WORD_CHAR = /[\p{L}\p{N}]/u;
const HAN = /\p{Script=Han}/u;
const NO_HEADWORDS: ReadonlySet<string> = new Set();

const longestWord = (
  lexicon: Lexicon,
  chars: readonly string[],
  start: number,
  end: number,
): readonly string[] | null => {
  for (let length = end - start; length > 0; length--) {
    const candidate = chars.slice(start, start + length);
    if (lexicon.has(candidate.join(""))) return candidate;
  }
  return null;
};

const forward = (lexicon: Lexicon, chars: readonly string[], maxLength: number) => {
  const segments: Segment[] = [];
  for (let index = 0; index < chars.length;) {
    const word = longestWord(lexicon, chars, index, Math.min(chars.length, index + maxLength));
    segments.push(
      word ? { chars: word, known: true } : { chars: chars.slice(index, index + 1), known: false },
    );
    index += word?.length ?? 1;
  }
  return segments;
};

const backward = (lexicon: Lexicon, chars: readonly string[], maxLength: number) => {
  const segments: Segment[] = [];
  for (let end = chars.length; end > 0;) {
    let word: readonly string[] | null = null;
    for (let start = Math.max(0, end - maxLength); start < end && word === null; start++) {
      const candidate = chars.slice(start, end);
      if (lexicon.has(candidate.join(""))) word = candidate;
    }
    segments.unshift(
      word ? { chars: word, known: true } : { chars: chars.slice(end - 1, end), known: false },
    );
    end -= word?.length ?? 1;
  }
  return segments;
};

const singleCount = (segments: readonly Segment[]): number =>
  segments.filter((segment) => segment.chars.length === 1).length;

const pickSegmentation = (
  forwardSegments: readonly Segment[],
  backwardSegments: readonly Segment[],
): readonly Segment[] => {
  if (forwardSegments.length !== backwardSegments.length) {
    return forwardSegments.length < backwardSegments.length ? forwardSegments : backwardSegments;
  }
  return singleCount(forwardSegments) < singleCount(backwardSegments)
    ? forwardSegments
    : backwardSegments;
};

const isLooseWordChar = (segment: Segment): boolean => {
  const [char] = segment.chars;
  return !segment.known && char != null && WORD_CHAR.test(char) && !HAN.test(char);
};

const mergeLooseWords = (segments: readonly Segment[]): readonly Segment[] => {
  const merged: Segment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (previous && isLooseWordChar(previous) && isLooseWordChar(segment)) {
      merged[merged.length - 1] = { chars: [...previous.chars, ...segment.chars], known: false };
    } else {
      merged.push(segment);
    }
  }
  return merged;
};

const wordLength = (word: string): number => Array.from(word).length;

/**
 * Bidirectional maximum matching over the lexicon; unknown characters stay single. `extra`
 * headwords count for that call only, and the lexicon is not walked again for them.
 */
export const createSegmenter = (
  lexicon: ReadonlySet<string>,
): ((text: string, extra?: ReadonlySet<string>) => readonly Token[]) => {
  let lexiconMaxLength = 1;
  for (const word of lexicon) lexiconMaxLength = Math.max(lexiconMaxLength, wordLength(word));

  return (text, extra = NO_HEADWORDS) => {
    const chars = Array.from(text);
    const words: Lexicon =
      extra.size === 0 ? lexicon : { has: (word) => lexicon.has(word) || extra.has(word) };
    const maxLength = Math.max(lexiconMaxLength, ...Array.from(extra, wordLength));
    const segments = mergeLooseWords(
      pickSegmentation(forward(words, chars, maxLength), backward(words, chars, maxLength)),
    );
    let offset = 0;
    return segments.map(({ chars: segmentChars }) => {
      const segmentText = segmentChars.join("");
      const token = {
        text: segmentText,
        start: offset,
        end: offset + segmentText.length,
        isWord: WORD_CHAR.test(segmentText),
      };
      offset = token.end;
      return token;
    });
  };
};
