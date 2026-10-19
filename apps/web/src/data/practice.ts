import type { PresetSetting } from "./daily-goal.ts";

/** Typing cards, on by default (ADR 0011). */
export const PRACTICE_TYPING: PresetSetting<boolean> = {
  key: "openlinguo.practiceTyping",
  values: [true, false],
  fallback: true,
};

/** Writing cards, off by default (ADR 0011). */
export const PRACTICE_WRITING: PresetSetting<boolean> = {
  key: "openlinguo.practiceWriting",
  values: [true, false],
  fallback: false,
};

/** Writing cards written on paper and self-graded instead of drawn, off by default (ADR 0011). */
export const WRITE_ON_PAPER: PresetSetting<boolean> = {
  key: "openlinguo.writeOnPaper",
  values: [true, false],
  fallback: false,
};

/** The card types a session offers: the learner's settings, and what the pack supports. */
export type Practice = { readonly writing: boolean; readonly typing: boolean };
