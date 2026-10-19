import {
  err,
  ok,
  type AiProvenance,
  type InvalidReading,
  type LookupError,
  type PromptPack,
  type ReadingMismatch,
  type Result,
} from "@openlinguo/core";
import type { SentenceCorrection } from "./correction.ts";
import { deckWordId, MY_WORDS, type Database, type NoteContent } from "./database.ts";
import { putCards, type DeckFailure } from "./decks.ts";
import { guarded } from "./review-log.ts";

/** What « Make a card » proposes: the accepted sentence with the AI's pinyin and meaning. */
export const proposeNote = ({ corrected, reading, meaning }: SentenceCorrection): NoteContent => ({
  characters: corrected,
  pinyin: reading,
  meaning,
});

/** A syllable the dictionary does not give, with the character it was written for. */
export type FlaggedSyllable = ReadingMismatch & { readonly character: string };

export type PinyinProblem =
  | { readonly kind: "mismatch"; readonly mismatches: readonly FlaggedSyllable[] }
  | InvalidReading
  | LookupError;

/** Per field, what keeps the note from being created. */
export type ProposalCheck = {
  readonly characters: "empty" | null;
  readonly pinyin: PinyinProblem | null;
  readonly meaning: "empty" | null;
};

const trimmed = ({ characters, pinyin, meaning }: NoteContent): NoteContent => ({
  characters: characters.trim(),
  pinyin: pinyin.trim(),
  meaning: meaning.trim(),
});

/** Each pinyin syllable must be a dictionary reading of its character, never fixed here. */
export const checkProposal = async (
  content: NoteContent,
  checkReading: PromptPack["checkReading"],
): Promise<ProposalCheck> => {
  const { characters, pinyin, meaning } = trimmed(content);
  const checked = await checkReading(characters, pinyin).catch(
    (error: unknown): Result<readonly ReadingMismatch[], LookupError> =>
      err({ kind: "storage-failure", message: String(error) }),
  );
  return {
    characters: characters === "" ? "empty" : null,
    pinyin: !checked.ok
      ? checked.error
      : checked.value.length > 0
        ? {
            kind: "mismatch",
            mismatches: checked.value.map((mismatch) => ({
              ...mismatch,
              character: characters.slice(mismatch.start, mismatch.end),
            })),
          }
        : null,
    meaning: meaning === "" ? "empty" : null,
  };
};

export const isReady = (check: ProposalCheck): boolean =>
  check.characters === null && check.pinyin === null && check.meaning === null;

export type NoteFailure = DeckFailure | { readonly kind: "already-filed" };

/**
 * Creates the note with its recognition and recall cards in the deck, with its provenance, unless
 * the deck already holds the sentence.
 */
export const fileNote = (
  db: Database,
  deckId: string,
  content: NoteContent,
  provenance: AiProvenance,
  now: number,
): Promise<Result<null, NoteFailure>> =>
  guarded(() =>
    db.transaction(
      "rw",
      [db.decks, db.deckWords, db.notes, db.cards, db.reviews],
      async (): Promise<Result<null, NoteFailure>> => {
        if (deckId !== MY_WORDS && (await db.decks.get(deckId)) == null)
          return err({ kind: "unknown-deck", deckId });
        const note = trimmed(content);
        const filed = await db.deckWords.where("deckId").equals(deckId).toArray();
        const notes = await db.notes.bulkGet(
          filed.flatMap((row) => ("note" in row ? [row.note] : [])),
        );
        if (notes.some((stored) => stored?.characters.trim() === note.characters))
          return err({ kind: "already-filed" });
        const subject = { note: crypto.randomUUID() };
        const stored = await putCards(db, [subject]);
        if (!stored.ok) return stored;
        await db.notes.add({ ...note, id: subject.note, updatedAt: now, provenance });
        await db.deckWords.add({ ...subject, id: deckWordId(deckId, subject), deckId });
        return ok(null);
      },
    ),
  );
