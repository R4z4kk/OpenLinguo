import type { TextEncoding } from "./text-file.ts";

/** A `.txt` read in the library, waiting for the form that edits and saves it. */
export type StagedFile = {
  readonly name: string;
  readonly bytes: number;
  readonly encoding: TextEncoding;
  readonly text: string;
};

let staged: StagedFile | null = null;
let savedTitle: string | null = null;

export const stageFile = (file: StagedFile): void => {
  staged = file;
};

export const stagedFile = (): StagedFile | null => staged;

/** Leaving the form, saved or not: the next one starts empty. */
export const clearStagedFile = (): void => {
  staged = null;
};

export const rememberSaved = (title: string): void => {
  savedTitle = title;
};

/** The title saved just before the library opened, once. */
export const takeSaved = (): string | null => {
  const title = savedTitle;
  savedTitle = null;
  return title;
};
