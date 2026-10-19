import {
  applyReview,
  composeSession,
  CURRENT_SCHEDULER,
  dueToday,
  isWord,
  isWordType,
  NEW_CARD_STATE,
  ok,
  PAIRED_TYPES,
  subjectId,
  type CardState,
  type DictEntry,
  type Grade,
  type Grading,
  type NoteKey,
  type ProgressError,
  type Result,
  type SessionItem,
  type Subject,
  type WordKey,
} from "@openlinguo/core";
import type { ZhProficiency } from "@openlinguo/lang-zh";
import { wordAudioId, type AudioSource } from "./audio-packs.ts";
import { withAiGlosses } from "./ai-glosses.ts";
import { todayActivity } from "./daily-goal.ts";
import type { Database, NoteContent } from "./database.ts";
import { entryId, introduceWord, nextNewReadings, type LocalTime } from "./decks.ts";
import { toDictEntry } from "./dictionary.ts";
import type { Practice } from "./practice.ts";
import { guarded, recordReview, type ReviewLogFailure } from "./review-log.ts";
import { toneSyllables } from "./tone-card.ts";

/** A word with its entry, or a note with its content; `audio`: what plays it (see AudioSource). */
export type ReviewItem = (
  | (Extract<SessionItem, WordKey> & { readonly entry: DictEntry })
  | (Extract<SessionItem, NoteKey> & { readonly content: NoteContent })
) & { readonly state: CardState; readonly audio: AudioSource | null };

/**
 * `skipped`: cards whose reading left the dictionary or lost its stroke data, or whose note lost
 * its content. `toneHeldBack`: tone cards due today whose reading has no audio installed.
 */
export type Session = {
  readonly items: readonly ReviewItem[];
  readonly skipped: number;
  readonly toneHeldBack: number;
};

/** What can play each subject: a deck's own audio (`deck`), the audio pack's recording of a word (`pack`). */
export const audioFinder = async (
  db: Database,
  subjects: readonly Subject[],
): Promise<{
  readonly deck: (subject: Subject) => AudioSource | null;
  readonly pack: (word: WordKey) => AudioSource | null;
}> => {
  const filed = (
    await Promise.all(
      subjects.map((subject) =>
        "note" in subject
          ? db.deckWords.where("note").equals(subject.note).toArray()
          : db.deckWords
              .where("[headword+readingKey]")
              .equals([subject.headword, subject.readingKey])
              .toArray(),
      ),
    )
  ).flat();
  const voiced = new Set(
    (
      await Promise.all(filed.map((word) => db.audio.where(":id").equals(word.id).primaryKeys()))
    ).flat(),
  );
  const audioOf = new Map(
    filed.filter((word) => voiced.has(word.id)).map((word) => [subjectId(word), word.id] as const),
  );
  // One `equals` per key: `anyOf` walks the whole index in WebKit.
  const packVoiced = new Set(
    (
      await Promise.all(
        subjects
          .filter(isWord)
          .map((word) =>
            db.wordAudio
              .where(":id")
              .equals(wordAudioId(word.headword, word.readingKey))
              .primaryKeys(),
          ),
      )
    ).flat(),
  );
  return {
    deck: (subject) => {
      const id = audioOf.get(subjectId(subject)) ?? null;
      return id === null ? null : { table: "audio", id };
    },
    pack: (word) => {
      const id = wordAudioId(word.headword, word.readingKey);
      return packVoiced.has(id) ? { table: "wordAudio", id } : null;
    },
  };
};

export const loadSession = (
  db: Database,
  referential: ZhProficiency,
  now: LocalTime,
  newLimit: number,
  practice: Practice,
): Promise<Result<Session, ReviewLogFailure>> =>
  guarded(async () => {
    const newReadings = await nextNewReadings(db, referential, newLimit);
    if (!newReadings.ok) return newReadings;
    const cards = await db.cards.toArray();
    const recorded = new Set(await db.wordAudio.toCollection().primaryKeys());
    const storedWords = [
      ...new Map(
        cards
          .filter(isWord)
          .map((card) => [
            subjectId(card),
            { headword: card.headword, readingKey: card.readingKey },
          ]),
      ).values(),
    ];
    const toneWords = storedWords.filter(
      (word) =>
        recorded.has(wordAudioId(word.headword, word.readingKey)) &&
        toneSyllables(word.readingKey) !== null,
    );
    const stroked = practice.writing
      ? new Set(await db.strokes.toCollection().primaryKeys())
      : null;
    const writingWords =
      stroked === null
        ? []
        : storedWords.filter((word) =>
            Array.from(word.headword).every((character) => stroked.has(character)),
          );
    const written = new Set(writingWords.map(subjectId));
    const strokesLost =
      stroked === null
        ? 0
        : cards.filter(
            (card) =>
              card.type === "writing" &&
              card.phase !== "new" &&
              dueToday(card.due, now.at, now.utcOffsetMinutes) &&
              !written.has(subjectId(card)),
          ).length;
    const toned = new Set(toneWords.map(subjectId));
    const toneHeldBack = cards.filter(
      (card) =>
        card.type === "tone" &&
        card.phase !== "new" &&
        dueToday(card.due, now.at, now.utcOffsetMinutes) &&
        !toned.has(subjectId(card)),
    ).length;
    const items = composeSession({
      language: "zh",
      cards,
      newReadings: newReadings.value,
      toneWords,
      writingWords,
      typingWords: practice.typing ? storedWords : [],
      newLimit,
      at: now.at,
      utcOffsetMinutes: now.utcOffsetMinutes,
    });
    const states = new Map(cards.map((card) => [card.id, card]));
    const words = items.filter(isWord);
    const notes = items.filter((item) => "note" in item);
    const entries = new Map(
      (await db.entries.bulkGet(words.map(entryId))).flatMap((row) =>
        row == null ? [] : [[row.id, row] as const],
      ),
    );
    const aiGlosses = new Map(
      (await db.aiGlosses.bulkGet(words.map(entryId))).flatMap((row) =>
        row == null ? [] : [[row.id, row] as const],
      ),
    );
    const contents = new Map(
      (await db.notes.bulkGet(notes.map((item) => item.note))).flatMap((note) =>
        note == null ? [] : [[note.id, note] as const],
      ),
    );
    const audio = await audioFinder(db, items);
    /** A deck's own audio comes first, then the audio pack's recording of the reading. */
    const sourceOf = (item: SessionItem): AudioSource | null => {
      const deck = item.type === "tone" ? null : audio.deck(item);
      if (deck !== null) return deck;
      return "note" in item ? null : audio.pack(item);
    };
    const joined = items.flatMap((item): ReviewItem[] => {
      const shared = {
        state: states.get(item.cardId) ?? NEW_CARD_STATE,
        audio: sourceOf(item),
      };
      if ("note" in item) {
        const note = contents.get(item.note);
        if (note == null) return [];
        const { characters, pinyin, meaning } = note;
        return [{ ...item, ...shared, content: { characters, pinyin, meaning } }];
      }
      const row = entries.get(entryId(item));
      if (row == null) return [];
      const entry = withAiGlosses(toDictEntry(row, referential), aiGlosses.get(row.id) ?? null);
      return [{ ...item, ...shared, entry }];
    });
    return ok({
      items: joined,
      skipped: items.length - joined.length + strokesLost,
      toneHeldBack,
    });
  });

const comesBack = (state: CardState, now: LocalTime): boolean =>
  state.phase !== "review" && dueToday(state.due, now.at, now.utcOffsetMinutes);

/** The goal in effect, capped at the day's count by the grade that empties the session. */
const goalToStamp = async (
  db: Database,
  item: ReviewItem,
  grading: Grading,
  now: LocalTime,
  dailyGoal: number,
  last: boolean,
): Promise<Result<number, ReviewLogFailure | ProgressError>> => {
  if (!last) return ok(dailyGoal);
  const next = applyReview(item.state, grading);
  if (!next.ok) return next;
  if (comesBack(next.value, now)) return ok(dailyGoal);
  const today = await todayActivity(db, now);
  if (!today.ok) return today;
  return ok(Math.min(dailyGoal, today.value.reviews + 1));
};

/**
 * Records a grade, storing the cards of a band word first; the item comes back if still due today.
 * `last`: no other item is left in the session.
 */
export const gradeItem = async (
  db: Database,
  item: ReviewItem,
  grade: Grade,
  now: LocalTime,
  dailyGoal: number,
  last: boolean,
): Promise<Result<ReviewItem | null, ReviewLogFailure | ProgressError>> => {
  const grading = {
    grade,
    reviewedAt: now.at,
    utcOffsetMinutes: now.utcOffsetMinutes,
    scheduler: CURRENT_SCHEDULER,
  };
  const goal = await goalToStamp(db, item, grading, now, dailyGoal, last);
  if (!goal.ok) return goal;
  if (item.new) {
    const stored = await introduceWord(
      db,
      item,
      isWordType(item.type) ? [item.type] : PAIRED_TYPES,
    );
    if (!stored.ok) return stored;
  }
  const state = await recordReview(db, {
    ...grading,
    id: crypto.randomUUID(),
    cardId: item.cardId,
    dailyGoal: goal.value,
  });
  if (!state.ok) return state;
  return ok(comesBack(state.value, now) ? { ...item, new: false, state: state.value } : null);
};
