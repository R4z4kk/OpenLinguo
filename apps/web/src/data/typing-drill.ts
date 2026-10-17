import { isWord, ok, subjectId, type DictEntry, type Result, type WordKey } from "@openlinguo/core";
import type { ZhProficiency } from "@openlinguo/lang-zh";
import type { AudioSource } from "./audio-packs.ts";
import type { Database } from "./database.ts";
import { entryId } from "./decks.ts";
import { toDictEntry } from "./dictionary.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";
import { audioFinder } from "./session.ts";

const MINUTE = 60_000;

export const ROUND_SIZE = 10;

/** The lengths of a timed round, in minutes (ADR 0011). */
export const ROUND_MINUTES = [1, 2, 3, 5] as const;

export type RoundMinutes = (typeof ROUND_MINUTES)[number];

export type DrillWord = WordKey & { readonly entry: DictEntry };

export type RoundWord = DrillWord & { readonly audio: AudioSource | null };

type Headworded = { readonly headword: string };

/** `limit`: the time limit in milliseconds, `null` when untimed. `typed`: an answer per word reached. */
type RoundBase<W> = {
  readonly words: readonly W[];
  readonly typed: readonly string[];
  readonly startedAt: number;
  readonly limit: number | null;
};

export type RunningRound<W> = RoundBase<W> & { readonly endedAt: null };

export type EndedRound<W> = RoundBase<W> & { readonly endedAt: number };

export type Round<W> = RunningRound<W> | EndedRound<W>;

/** What was typed for a word, `null` when the round ended before it. */
export type WordOutcome<W> = {
  readonly word: W;
  readonly typed: string | null;
  readonly right: boolean;
};

/** `characters`: those of the right answers; `elapsed`: in milliseconds. */
export type RoundResult<W> = {
  readonly outcomes: readonly WordOutcome<W>[];
  readonly right: number;
  readonly characters: number;
  readonly elapsed: number;
  readonly perMinute: number;
};

/** The started words, those with a card, still in the dictionary. Nothing is stored. */
export const loadDrillWords = (
  db: Database,
  referential: ZhProficiency,
): Promise<Result<readonly DrillWord[], ReviewLogFailure>> =>
  guarded(async () => {
    const words = [
      ...new Map(
        (await db.cards.toArray())
          .filter(isWord)
          .map((card) => [
            subjectId(card),
            { headword: card.headword, readingKey: card.readingKey },
          ]),
      ).values(),
    ];
    const rows = await db.entries.bulkGet(words.map(entryId));
    return ok(
      words.flatMap((word, index) => {
        const row = rows[index];
        return row == null ? [] : [{ ...word, entry: toDictEntry(row, referential) }];
      }),
    );
  });

/** What plays each word, as on its cards: its deck's audio first, then the audio pack's. */
export const withAudio = (
  db: Database,
  words: readonly DrillWord[],
): Promise<Result<readonly RoundWord[], ReviewLogFailure>> =>
  guarded(async () => {
    const audio = await audioFinder(db, words);
    return ok(words.map((word) => ({ ...word, audio: audio.deck(word) ?? audio.pack(word) })));
  });

/** Up to `size` words drawn at random, each once; `random` returns a number in [0, 1). */
export const drawRound = <W>(
  words: readonly W[],
  size: number,
  random: () => number,
): readonly W[] => {
  const pool = [...words];
  const drawn: W[] = [];
  while (drawn.length < size && pool.length > 0) {
    const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    drawn.push(...pool.splice(index, 1));
  }
  return drawn;
};

export const startRound = <W>(
  words: readonly W[],
  startedAt: number,
  limit: number | null,
): RunningRound<W> => ({ words, typed: [], startedAt, limit, endedAt: null });

const deadline = <W>(round: Round<W>): number =>
  round.limit === null ? Number.POSITIVE_INFINITY : round.startedAt + round.limit;

/** The word to type, `null` once every word is answered. */
export const currentWord = <W>(round: Round<W>): W | null =>
  round.words[round.typed.length] ?? null;

/** Milliseconds left, `null` when untimed. */
export const timeLeft = <W>(round: Round<W>, now: number): number | null =>
  round.limit === null ? null : Math.max(0, deadline(round) - now);

/** Ends the round at `at`, or at its limit when that came first. */
export const endRound = <W>(round: Round<W>, at: number): EndedRound<W> =>
  round.endedAt === null ? { ...round, endedAt: Math.min(at, deadline(round)) } : round;

/** Ends a timed round once its time is up. */
export const tick = <W>(round: Round<W>, now: number): Round<W> =>
  timeLeft(round, now) === 0 ? endRound(round, now) : round;

/** Records the answer to the current word; the last one ends the round. Too late, it is dropped. */
export const answer = <W>(round: Round<W>, text: string, at: number): Round<W> => {
  if (round.endedAt !== null) return round;
  if (at >= deadline(round)) return endRound(round, at);
  const next = { ...round, typed: [...round.typed, text] };
  return next.typed.length >= round.words.length ? endRound(next, at) : next;
};

export const charactersPerMinute = (characters: number, elapsed: number): number =>
  elapsed <= 0 ? 0 : Math.round((characters * MINUTE) / elapsed);

/** A word is right when its headword was typed exactly (ADR 0011); a word not reached is missed. */
export const roundResult = <W extends Headworded>(round: EndedRound<W>): RoundResult<W> => {
  const outcomes = round.words.map((word, index) => {
    const typed = round.typed[index] ?? null;
    return { word, typed, right: typed === word.headword };
  });
  const rightWords = outcomes.filter(({ right }) => right);
  const characters = rightWords.reduce(
    (count, { word }) => count + Array.from(word.headword).length,
    0,
  );
  const elapsed = round.endedAt - round.startedAt;
  return {
    outcomes,
    right: rightWords.length,
    characters,
    elapsed,
    perMinute: charactersPerMinute(characters, elapsed),
  };
};
