import {
  chat,
  err,
  ok,
  type AiError,
  type DictEntry,
  type GlossAnswer,
  type GlossInput,
  type PromptTask,
  type Result,
  type WordKey,
} from "@openlinguo/core";
import { rememberMode, type AiConnection } from "./ai-settings.ts";
import type { Database, StoredAiGloss } from "./database.ts";
import { entryId } from "./decks.ts";
import { AI_GLOSS_SOURCE, summarizeGlosses } from "./gloss-summary.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

const hasFrench = (entry: DictEntry): boolean => entry.glosses.some(({ lang }) => lang === "fr");

/** What « Translate to French » sends for an entry with no French gloss; `null` hides it. */
export const glossInput = (entry: DictEntry): GlossInput | null => {
  const english = summarizeGlosses(entry.glosses, ["en"]);
  return entry.reading === null || english === null || hasFrench(entry)
    ? null
    : { headword: entry.headword, reading: entry.reading, glosses: english.texts };
};

export const loadAiGloss = (
  db: Database,
  word: WordKey,
): Promise<Result<StoredAiGloss | null, ReviewLogFailure>> =>
  guarded(async () => ok((await db.aiGlosses.get(entryId(word))) ?? null));

export type TranslationFailure =
  | { readonly kind: "ai"; readonly error: AiError }
  | { readonly kind: "storage"; readonly error: ReviewLogFailure };

/** One entry per call (ADR 0012), stored with its provenance only when the answer is valid. */
export const translateEntry = async (
  db: Database,
  connection: AiConnection,
  task: PromptTask<GlossInput, GlossAnswer>,
  word: WordKey,
  input: GlossInput,
  signal: AbortSignal,
  now: Date,
): Promise<Result<StoredAiGloss, TranslationFailure>> => {
  const answer = await chat({
    endpoint: connection.endpoint,
    model: connection.model,
    messages: task.messages(input),
    schema: task.schema(input),
    mode: connection.mode,
    signal,
  });
  if (!answer.ok) return err({ kind: "ai", error: answer.error });
  const { glosses } = answer.value.value;
  const row: StoredAiGloss = {
    id: entryId(word),
    headword: word.headword,
    readingKey: word.readingKey,
    // The schema checks there is one French gloss per English sense.
    senses: input.glosses.flatMap((english, index) => {
      const french = glosses[index] ?? null;
      return french === null ? [] : [{ english, french }];
    }),
    provenance: {
      origin: "ai",
      provider: connection.endpoint.provider,
      model: connection.model,
      promptVersion: task.id,
      createdAt: now.toISOString(),
    },
  };
  const stored = await guarded(async () => {
    const mode = await rememberMode(db, connection, answer.value.mode);
    if (!mode.ok) return mode;
    await db.aiGlosses.put(row);
    return ok(row);
  });
  return stored.ok ? stored : err({ kind: "storage", error: stored.error });
};

export const deleteAiGloss = (
  db: Database,
  word: WordKey,
): Promise<Result<null, ReviewLogFailure>> =>
  guarded(async () => {
    await db.aiGlosses.delete(entryId(word));
    return ok(null);
  });

/** The entry with its AI French glosses, unless the dictionary now has its own. */
export const withAiGlosses = (entry: DictEntry, row: StoredAiGloss | null): DictEntry =>
  row === null || hasFrench(entry)
    ? entry
    : {
        ...entry,
        glosses: [
          ...entry.glosses,
          ...row.senses.map(({ french }) => ({
            lang: "fr" as const,
            text: french,
            source: AI_GLOSS_SOURCE,
          })),
        ],
      };
