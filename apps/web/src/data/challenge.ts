import {
  isWord,
  learningDay,
  ok,
  subjectId,
  type DictEntry,
  type Result,
  type WordKey,
} from "@openlinguo/core";
import type { ZhProficiency } from "@openlinguo/lang-zh";
import type { AudioSource } from "./audio-packs.ts";
import { currentCorrections, type Corrections } from "./correction.ts";
import type { PresetSetting } from "./daily-goal.ts";
import type { Database, StoredChallenge } from "./database.ts";
import { entryId, type LocalTime } from "./decks.ts";
import { toDictEntry } from "./dictionary.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";
import { audioFinder } from "./session.ts";

export const CHALLENGE_SENTENCES = 5;

/** The fields use the in-app input method, else the device keyboard; remembered (ADR 0012). */
export const CHALLENGE_APP_IME: PresetSetting<boolean> = {
  key: "openlinguo.challengeAppIme",
  values: [true, false],
  fallback: true,
};

/** `entry`: `null` once the word has left the dictionary. */
export type ChallengeWord = WordKey & {
  readonly entry: DictEntry | null;
  readonly audio: AudioSource | null;
};

export type Challenge = {
  readonly day: string;
  readonly word: ChallengeWord;
  readonly sentences: readonly string[];
  readonly corrections: Corrections;
};

const EMPTY: readonly string[] = Array.from({ length: CHALLENGE_SENTENCES }, () => "");
export const NO_CORRECTIONS: Corrections = Array.from({ length: CHALLENGE_SENTENCES }, () => null);

/** The word whose first review, all its cards together, came last on `day`. */
export const latestStartedWord = async (db: Database, day: string): Promise<WordKey | null> => {
  const subjects = Map.groupBy((await db.cards.toArray()).filter(isWord), subjectId);
  const started = [...subjects.values()].filter(
    (cards) =>
      cards.some((card) => card.firstReviewDay === day) &&
      cards.every((card) => card.firstReviewDay === null || card.firstReviewDay >= day),
  );
  const firsts = await Promise.all(
    started.map(async (cards) => {
      const reviews = await Promise.all(
        cards.map((card) => db.reviews.where("cardId").equals(card.id).toArray()),
      );
      return { cards, at: Math.min(...reviews.flat().map((review) => review.reviewedAt)) };
    }),
  );
  const [latest] = firsts.filter(({ at }) => Number.isFinite(at)).sort((a, b) => b.at - a.at);
  const card = latest?.cards[0] ?? null;
  return card === null ? null : { headword: card.headword, readingKey: card.readingKey };
};

const withWord = async (
  db: Database,
  referential: ZhProficiency,
  day: string,
  word: WordKey,
  sentences: readonly string[],
  corrections: Corrections,
): Promise<Challenge> => {
  const row = (await db.entries.get(entryId(word))) ?? null;
  const audio = await audioFinder(db, [word]);
  return {
    day,
    word: {
      headword: word.headword,
      readingKey: word.readingKey,
      entry: row === null ? null : toDictEntry(row, referential),
      audio: audio.deck(word) ?? audio.pack(word),
    },
    sentences,
    corrections,
  };
};

/** Today's challenge: the one saved today, else one with the latest word started today. */
export const loadTodayChallenge = (
  db: Database,
  referential: ZhProficiency,
  now: LocalTime,
): Promise<Result<Challenge | null, ReviewLogFailure>> =>
  guarded(async () => {
    const day = learningDay(now.at, now.utcOffsetMinutes);
    const stored = (await db.challenges.get(day)) ?? null;
    const word = stored ?? (await latestStartedWord(db, day));
    if (word === null) return ok(null);
    return ok(
      await withWord(
        db,
        referential,
        day,
        word,
        stored?.sentences ?? EMPTY,
        stored?.corrections ?? NO_CORRECTIONS,
      ),
    );
  });

/** The challenge saved on `day`, `null` when none was. */
export const loadChallenge = (
  db: Database,
  referential: ZhProficiency,
  day: string,
): Promise<Result<Challenge | null, ReviewLogFailure>> =>
  guarded(async () => {
    const stored = (await db.challenges.get(day)) ?? null;
    if (stored === null) return ok(null);
    return ok(await withWord(db, referential, day, stored, stored.sentences, stored.corrections));
  });

/** Every saved challenge, the latest day first. */
export const listChallenges = (
  db: Database,
): Promise<Result<readonly StoredChallenge[], ReviewLogFailure>> =>
  guarded(async () => ok(await db.challenges.reverse().toArray()));

/**
 * Keeps the sentences of the challenge's day, with the corrections still about them. Nothing is
 * written while every field is empty and none was saved: `false`.
 */
export const saveChallenge = (
  db: Database,
  { day, word, sentences, corrections }: Challenge,
  at: number,
): Promise<Result<boolean, ReviewLogFailure>> =>
  guarded(async () => {
    const filled = sentences.some((sentence) => sentence.trim() !== "");
    if (!filled && (await db.challenges.get(day)) == null) return ok(false);
    await db.challenges.put({
      day,
      headword: word.headword,
      readingKey: word.readingKey,
      sentences,
      corrections: currentCorrections(sentences, corrections),
      updatedAt: at,
    });
    return ok(true);
  });
