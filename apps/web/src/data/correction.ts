import {
  AiProvenance,
  chat,
  err,
  ok,
  type AiError,
  type CorrectionAnswer,
  type CorrectionInput,
  type GlossLanguage,
  type PromptTask,
  type ReadingMismatch,
  type Result,
  type StructuredMode,
} from "@openlinguo/core";
import { joinedToNumbered, toDiacritic } from "@openlinguo/lang-zh";
import { z } from "zod";
import type { AiConnection } from "./ai-settings.ts";

export const CORRECTION_CHOICES = ["accepted", "kept"] as const;
export type CorrectionChoice = (typeof CORRECTION_CHOICES)[number];

/** A sentence as sent, its correction, and « Accept » or « Keep mine »; with its provenance. */
export const SentenceCorrection = z.object({
  original: z.string(),
  corrected: z.string(),
  changes: z
    .array(z.object({ from: z.string(), to: z.string(), explanation: z.string() }))
    .readonly(),
  reading: z.string(),
  meaning: z.string(),
  choice: z.enum(CORRECTION_CHOICES).nullable(),
  provenance: AiProvenance,
});
export type SentenceCorrection = z.output<typeof SentenceCorrection>;

/** One per field: `null` while it is empty, not corrected, or changed since. */
export type Corrections = readonly (SentenceCorrection | null)[];

export type CorrectionTask = PromptTask<CorrectionInput, CorrectionAnswer>;

/** What « Correct » sends: the filled fields only. */
export const correctionInput = (
  word: string | null,
  sentences: readonly string[],
  language: GlossLanguage,
): CorrectionInput => ({
  word,
  sentences: sentences.filter((sentence) => sentence.trim() !== ""),
  language,
});

/** The corrections still about the text of their field. */
export const currentCorrections = (
  sentences: readonly string[],
  corrections: Corrections,
): Corrections =>
  sentences.map((sentence, index) => {
    const correction = corrections[index] ?? null;
    return correction?.original === sentence ? correction : null;
  });

/** Every filled field has its correction, and one field at least is filled. */
export const isCorrected = (sentences: readonly string[], corrections: Corrections): boolean => {
  const current = currentCorrections(sentences, corrections);
  const filled = sentences.flatMap((sentence, index) => (sentence.trim() === "" ? [] : [index]));
  return filled.length > 0 && filled.every((index) => current[index] != null);
};

export type CorrectionReply = { readonly corrections: Corrections; readonly mode: StructuredMode };

/** One call for the filled fields; nothing is stored here. */
export const requestCorrection = async (
  connection: AiConnection,
  task: CorrectionTask,
  word: string | null,
  sentences: readonly string[],
  language: GlossLanguage,
  signal: AbortSignal,
): Promise<Result<CorrectionReply, AiError>> => {
  const input = correctionInput(word, sentences, language);
  const answer = await chat({
    endpoint: connection.endpoint,
    model: connection.model,
    messages: task.messages(input),
    schema: task.schema(input),
    mode: connection.mode,
    signal,
  });
  if (!answer.ok) return answer;
  const filled = sentences.filter((original) => original.trim() !== "");
  const replies = filled.map(
    (_, at) => answer.value.value.sentences.find(({ index }) => index === at + 1) ?? null,
  );
  if (!ownSentences(filled, replies)) {
    return err({ kind: "invalid-response", status: null, message: null });
  }
  const provenance: AiProvenance = {
    origin: "ai",
    provider: connection.endpoint.provider,
    model: connection.model,
    promptVersion: task.id,
    createdAt: new Date().toISOString(),
  };
  return ok({
    mode: answer.value.mode,
    corrections: sentences.map((original) => {
      if (original.trim() === "") return null;
      const reply = replies.shift() ?? null;
      if (reply === null) return null;
      const { corrected, changes, reading, meaning } = reply;
      return { original, corrected, changes, reading, meaning, choice: null, provenance };
    }),
  });
};

export type DiffPart = { readonly kind: "same" | "added" | "removed"; readonly text: string };

/**
 * Character diff on code points, by longest common subsequence: a removal comes before the
 * insertion that replaces it.
 */
export const diffChars = (from: string, to: string): readonly DiffPart[] => {
  const a = Array.from(from);
  const b = Array.from(to);
  const width = b.length + 1;
  // Common length of a[i…] and b[j…] at i * width + j.
  const common = new Int32Array((a.length + 1) * width);
  const at = (i: number, j: number): number => common[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      common[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string): void => {
    const last = parts.at(-1) ?? null;
    if (last?.kind === kind) parts[parts.length - 1] = { kind, text: last.text + text };
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const removed = a[i] ?? null;
    const added = b[j] ?? null;
    if (removed !== null && removed === added) {
      push("same", removed);
      i += 1;
      j += 1;
    } else if (removed !== null && (added === null || at(i + 1, j) >= at(i, j + 1))) {
      push("removed", removed);
      i += 1;
    } else if (added !== null) {
      push("added", added);
      j += 1;
    }
  }
  return parts;
};

const likeness = (a: string, b: string): number => {
  const total = Array.from(a).length + Array.from(b).length;
  const common = diffChars(a, b)
    .filter(({ kind }) => kind === "same")
    .reduce((sum, { text }) => sum + Array.from(text).length, 0);
  return total === 0 ? 1 : (2 * common) / total;
};

/** The index is the model's word: each answer must also be closest to the sentence it names. */
const ownSentences = (
  originals: readonly string[],
  answers: readonly ({ readonly corrected: string } | null)[],
): boolean =>
  answers.every((answer, index) => {
    if (answer === null) return false;
    const own = likeness(originals[index] ?? "", answer.corrected);
    return originals.every((other, at) => at === index || likeness(other, answer.corrected) <= own);
  });

const HAN = /\p{Script=Han}/u;
const NOT_PINYIN = /[^\p{L}\p{M}\s'’-]+/gu;

/** A numbered syllable with tone marks, or as given when it is not one. */
export const diacritic = (numbered: string): string => {
  const shown = toDiacritic(numbered);
  return shown.ok ? shown.value : numbered;
};

/** A syllable of the AI's reading, numbered, with the dictionary's objection to it. */
export type ReadingSyllable = {
  readonly numbered: string;
  readonly mismatch: ReadingMismatch | null;
};

/** The reading split into one syllable per Han character of `text`; `null` when it cannot be. */
export const readingSyllables = (
  text: string,
  reading: string,
  mismatches: readonly ReadingMismatch[],
): readonly ReadingSyllable[] | null => {
  const starts: number[] = [];
  let offset = 0;
  for (const character of text) {
    if (HAN.test(character)) starts.push(offset);
    offset += character.length;
  }
  const split = joinedToNumbered(reading.replace(NOT_PINYIN, " "), starts.length);
  if (!split.ok) return null;
  const syllables = split.value.split(" ");
  if (syllables.length !== starts.length) return null;
  return syllables.map((numbered, index) => ({
    numbered,
    mismatch: mismatches.find(({ start }) => start === starts[index]) ?? null,
  }));
};
