import { err, ok, type Result } from "@openlinguo/core";
import type { Database, StoredText } from "./database.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

/** Confirmed by the reader benchmark on 2026-10-22 (ADR 0014, update). */
export const MAX_TEXT_CHARACTERS = 20_000;
export const TITLE_MAX = 100;
const DEFAULT_TITLE_CHARACTERS = 12;

export const characterCount = (text: string): number => Array.from(text).length;

/** The first characters of the first line that has any. */
export const defaultTitle = (body: string): string => {
  const line = body.split(/\r?\n/u).find((candidate) => candidate.trim() !== "") ?? "";
  const characters = Array.from(line.trim().replace(/\s+/gu, " "));
  return characters.length > DEFAULT_TITLE_CHARACTERS
    ? `${characters.slice(0, DEFAULT_TITLE_CHARACTERS).join("")}…`
    : characters.join("");
};

export type Draft = { readonly title: string; readonly body: string };

export type DraftFailure =
  | { readonly kind: "empty" }
  | { readonly kind: "too-long"; readonly count: number; readonly max: number }
  | { readonly kind: "title-too-long"; readonly max: number };

export type TextFailure = DraftFailure | ReviewLogFailure;

/** The text and title as they are stored: trimmed, the title filled in. */
export const checkDraft = ({ title, body }: Draft): Result<Draft, DraftFailure> => {
  const text = body.trim();
  if (text === "") return err({ kind: "empty" });
  const count = characterCount(text);
  if (count > MAX_TEXT_CHARACTERS)
    return err({ kind: "too-long", count, max: MAX_TEXT_CHARACTERS });
  const named = title.trim();
  if (characterCount(named) > TITLE_MAX) return err({ kind: "title-too-long", max: TITLE_MAX });
  return ok({ title: named === "" ? defaultTitle(text) : named, body: text });
};

export type NewText = Draft & { readonly source: "paste" | "file" };

/** Keeps a text typed, pasted or read from a file; `id` is a random UUID. */
export const saveText = (
  db: Database,
  { source, ...draft }: NewText,
  at: number,
  id: string,
): Promise<Result<StoredText, TextFailure>> =>
  guarded<StoredText, TextFailure>(async () => {
    const checked = checkDraft(draft);
    if (!checked.ok) return checked;
    const text: StoredText = {
      id,
      ...checked.value,
      source,
      createdAt: at,
      provenance: null,
      readingChoices: {},
    };
    await db.texts.add(text);
    return ok(text);
  });

/** The text, `null` when the id is unknown (deleted, or a stale link). */
export const loadText = (
  db: Database,
  id: string,
): Promise<Result<StoredText | null, ReviewLogFailure>> =>
  guarded(async () => ok((await db.texts.get(id)) ?? null));

/** Every text, the latest first. */
export const listTexts = (db: Database): Promise<Result<readonly StoredText[], ReviewLogFailure>> =>
  guarded(async () => ok(await db.texts.orderBy("createdAt").reverse().toArray()));

/** Removes the text and its chosen readings; cards, marks and the lexicon stay. */
export const deleteText = (db: Database, id: string): Promise<Result<null, ReviewLogFailure>> =>
  guarded(async () => {
    await db.texts.delete(id);
    return ok(null);
  });
