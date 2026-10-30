import {
  isWord,
  ok,
  subjectId,
  type AiProvenance,
  type LanguageId,
  type Result,
  type StoryAnswer,
} from "@openlinguo/core";
import type { Database, StoredText } from "./database.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";
import { loadKnownWords } from "./text-coverage.ts";
import { checkDraft, type DraftFailure, type TextFailure } from "./texts.ts";

/** What `zh-story-v1` accepts. */
export const STORY_WORDS_MAX = 20;

/** Why the text check refused an answer, worded as a schema error is. */
export const describeRefusal = (failure: DraftFailure): string => {
  switch (failure.kind) {
    case "empty":
      return "paragraphs: empty";
    case "too-long":
      return `paragraphs: ${String(failure.count)} characters, the limit is ${String(failure.max)}`;
    case "title-too-long":
      return `title: more than ${String(failure.max)} characters`;
  }
};

/**
 * The words with a card in their learning steps and no reading known otherwise, the most recently
 * reviewed first (by the review log: cards keep only the day), at most `limit`.
 */
export const learningWords = (
  db: Database,
  language: LanguageId,
  limit: number = STORY_WORDS_MAX,
): Promise<Result<readonly string[], ReviewLogFailure>> =>
  guarded(async () => {
    const known = await loadKnownWords(db, language);
    if (!known.ok) return known;
    const learning = (await db.cards.toArray()).flatMap((card) =>
      card.language === language &&
      isWord(card) &&
      card.phase === "learning" &&
      known.value.words.get(subjectId(card)) === "learning"
        ? [card]
        : [],
    );
    const logs = await Promise.all(
      learning.map((card) => db.reviews.where("cardId").equals(card.id).toArray()),
    );
    const latest = new Map<string, number>();
    learning.forEach(({ headword }, index) => {
      const reviewed = Math.max(0, ...(logs[index] ?? []).map(({ reviewedAt }) => reviewedAt));
      latest.set(headword, Math.max(latest.get(headword) ?? 0, reviewed));
    });
    return ok(
      [...latest]
        .toSorted(([a, at], [b, other]) => other - at || (a < b ? -1 : a > b ? 1 : 0))
        .slice(0, limit)
        .map(([headword]) => headword),
    );
  });

/**
 * Keeps a valid story as a text, and its names as the AI's answers to propose in the unknown-words
 * panel, in one transaction: an answer the text check refuses leaves nothing behind. A name
 * already answered is left as it is.
 */
export const saveStory = (
  db: Database,
  { title, paragraphs, names }: StoryAnswer,
  provenance: AiProvenance,
  at: number,
  id: string,
): Promise<Result<StoredText, TextFailure>> =>
  guarded<StoredText, TextFailure>(() =>
    db.transaction("rw", [db.texts, db.resolutions], async () => {
      const checked = checkDraft({ title, body: paragraphs.join("\n") });
      if (!checked.ok) return checked;
      const text: StoredText = {
        id,
        ...checked.value,
        source: "ai",
        createdAt: at,
        provenance,
        readingChoices: {},
      };
      const kinds = new Map(names.map(({ text: name, kind }) => [name.trim(), kind]));
      const answered = await db.resolutions.bulkGet([...kinds.keys()].map((name) => [name, "ai"]));
      await db.texts.add(text);
      await db.resolutions.bulkAdd(
        [...kinds]
          .filter((_, index) => answered[index] == null)
          .map(([sequence, kind]) => ({
            sequence,
            source: "ai" as const,
            found: [{ kind, reading: null, gloss: null, reference: null, provenance }],
            checkedAt: at,
          })),
      );
      return ok(text);
    }),
  );
