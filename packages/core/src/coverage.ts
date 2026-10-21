import type { LanguageId, Token } from "./language-pack.ts";
import {
  isWord,
  subjectId,
  type Card,
  type CardState,
  type Phase,
  type Subject,
  type WordKey,
} from "./srs.ts";

const HAN = /\p{Script=Han}/u;

const KNOWN_PHASES: ReadonlySet<Phase> = new Set(["review", "relearning"]);

/** `learning`: a card is still in its learning steps (« en cours »). */
export type Knowledge = "known" | "learning" | "unknown";

/** What the knownWords reads of a stored card, whatever its type. */
export type KnownWordsCard = Subject & Pick<Card, "language" | "type"> & Pick<CardState, "phase">;

export type KnownWordsInput = {
  readonly language: LanguageId;
  readonly cards: readonly KnownWordsCard[];
  /** Readings marked « Je connais ». */
  readonly marks: readonly WordKey[];
  /** Validated proper names, matched on their characters. */
  readonly names: readonly string[];
};

export type KnownWords = {
  readonly words: ReadonlyMap<string, Exclude<Knowledge, "unknown">>;
  readonly names: ReadonlySet<string>;
};

/**
 * Known: a card of the reading in `review` or `relearning`, or a mark. A card in `learning` is
 * « en cours » unless the reading is known otherwise; a `new` card counts for nothing.
 */
export const knownWords = ({ language, cards, marks, names }: KnownWordsInput): KnownWords => {
  const words = new Map<string, Exclude<Knowledge, "unknown">>();
  for (const mark of marks) words.set(subjectId(mark), "known");
  for (const card of cards) {
    if (card.language !== language || !isWord(card)) continue;
    const id = subjectId(card);
    if (KNOWN_PHASES.has(card.phase)) words.set(id, "known");
    else if (card.phase === "learning" && !words.has(id)) words.set(id, "learning");
  }
  return { words, names: new Set(names) };
};

/** A token of a text with the reading in effect: the one chosen, else the first. */
export type Occurrence = Pick<Token, "text" | "isWord"> & {
  /** `null` when the dictionary has no reading for the word. */
  readonly readingKey: string | null;
};

export const knowledgeOf = (vocab: KnownWords, occurrence: Occurrence): Knowledge => {
  if (vocab.names.has(occurrence.text)) return "known";
  if (occurrence.readingKey === null) return "unknown";
  const key = { headword: occurrence.text, readingKey: occurrence.readingKey };
  return vocab.words.get(subjectId(key)) ?? "unknown";
};

export type Coverage = {
  readonly known: number;
  readonly total: number;
  /** Distinct words, by characters and reading, that are not known: « en cours » ones too. */
  readonly unknownWords: number;
};

/** Known Han word tokens over Han word tokens, per occurrence; punctuation, Latin and digits out. */
export const coverage = (occurrences: readonly Occurrence[], vocab: KnownWords): Coverage => {
  let known = 0;
  let total = 0;
  const unknownWords = new Set<string>();
  for (const occurrence of occurrences) {
    if (!occurrence.isWord || !HAN.test(occurrence.text)) continue;
    total += 1;
    if (knowledgeOf(vocab, occurrence) === "known") known += 1;
    else unknownWords.add(JSON.stringify([occurrence.text, occurrence.readingKey]));
  }
  return { known, total, unknownWords: unknownWords.size };
};
