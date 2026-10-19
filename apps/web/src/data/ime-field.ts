import type { ImeCandidate, ImeError, Result } from "@openlinguo/core";
import { splitPinyin } from "@openlinguo/lang-zh";

export const CANDIDATES_PER_PAGE = 9;

export type ImeCandidates = Result<readonly [ImeCandidate, ...ImeCandidate[]], ImeError>;

/** The candidates found for one input. */
export type ImeLookup = { readonly input: string; readonly candidates: ImeCandidates };

/** What is being typed: the pinyin the input shows, its last lookup, the highlighted candidate. */
export type ImeTyping = {
  readonly buffer: string;
  /** Its candidates are offered only while its input is still the buffer. */
  readonly lookup: ImeLookup | null;
  readonly active: number;
};

/** The field: the characters committed so far, the answer, then what is being typed. */
export type ImeFieldState = ImeTyping & { readonly committed: string };

export const NOT_TYPING: ImeTyping = { buffer: "", lookup: null, active: 0 };

const HAN = /\p{Script=Han}/u;
const PINYIN_CHARACTER = /[a-zü'’1-5]/iu;
const PINYIN_INPUT = /^[a-zü'’1-5]+$/iu;
const PUNCTUATION = /\p{P}/u;

/** What a Chinese input method types for ASCII punctuation. */
const FULL_WIDTH: Readonly<Record<string, string>> = {
  ".": "。",
  ",": "，",
  "?": "？",
  "!": "！",
  ";": "；",
  ":": "：",
};

/** Han characters, and punctuation while no pinyin is pending (it would land before its words). */
const committedAs = (character: string, pending: boolean): string | null => {
  if (HAN.test(character)) return character;
  if (pending || PINYIN_CHARACTER.test(character)) return null;
  const wide = (character.codePointAt(0) ?? 0) > 0x7f && PUNCTUATION.test(character);
  return FULL_WIDTH[character] ?? (wide ? character : null);
};

/** The input to look candidates up for: `null` when nothing is typed or it is not pinyin. */
export const lookupInput = ({ buffer }: ImeTyping): string | null =>
  PINYIN_INPUT.test(buffer) ? buffer : null;

/** Candidates for the buffer as it is now: none while its lookup is pending or failed. */
export const candidatesOf = ({ buffer, lookup }: ImeTyping): readonly ImeCandidate[] =>
  lookup?.input === buffer && lookup.candidates.ok ? lookup.candidates.value : [];

/**
 * The input's new text. While the system's input method composes, it is kept as it is; otherwise
 * Han characters are committed as typed, pinyin letters, apostrophes and tones 1–5 stay in the
 * buffer, punctuation is committed full width while the buffer is empty, anything else is dropped.
 */
export const typed = (state: ImeFieldState, value: string, composing: boolean): ImeFieldState => {
  if (composing) return { ...state, buffer: value };
  const characters = Array.from(value);
  const buffer = characters.filter((character) => PINYIN_CHARACTER.test(character)).join("");
  const committed = characters.flatMap((character) => {
    const text = committedAs(character, buffer !== "");
    return text === null ? [] : [text];
  });
  return { ...state, committed: state.committed + committed.join(""), buffer };
};

/** A lookup came back: kept only if the buffer has not changed since, the first candidate active. */
export const looked = <State extends ImeTyping>(state: State, lookup: ImeLookup): State =>
  lookup.input === state.buffer ? { ...state, lookup, active: 0 } : state;

/** Commits a candidate: its text joins the answer, its syllables leave the buffer. */
export const commit = (state: ImeFieldState, index: number): ImeFieldState => {
  const candidate = candidatesOf(state)[index] ?? null;
  if (candidate === null) return state;
  return {
    committed: state.committed + candidate.text,
    buffer: state.buffer.slice(candidate.consumed),
    lookup: null,
    active: 0,
  };
};

const move = (state: ImeFieldState, step: 1 | -1): ImeFieldState => {
  const last = candidatesOf(state).length - 1;
  return { ...state, active: Math.min(Math.max(state.active + step, 0), last) };
};

/** The first candidate of the next or previous page, from the last page back to the first. */
export const turnPage = (state: ImeFieldState, step: 1 | -1): ImeFieldState => {
  const pages = Math.ceil(candidatesOf(state).length / CANDIDATES_PER_PAGE);
  if (pages === 0) return state;
  const page = (Math.floor(state.active / CANDIDATES_PER_PAGE) + step + pages) % pages;
  return { ...state, active: page * CANDIDATES_PER_PAGE };
};

export type ImeKey = {
  readonly key: string;
  /** The system's input method is composing: the key is its own. */
  readonly composing: boolean;
  /** Alt, Control or Meta is held. */
  readonly modified: boolean;
};

/** `pass` leaves the key to the browser; the others are the field's. */
export type ImeKeyOutcome =
  | { readonly kind: "state"; readonly state: ImeFieldState }
  | { readonly kind: "submit" }
  | { readonly kind: "pass" };

const PASS: ImeKeyOutcome = { kind: "pass" };
const SUBMIT: ImeKeyOutcome = { kind: "submit" };
const handled = (state: ImeFieldState): ImeKeyOutcome => ({ kind: "state", state });

/**
 * Arrows move the highlight, Page Up and Page Down page, Space or Enter commit the highlighted
 * candidate, Enter on an empty buffer submits, Escape clears the buffer, Backspace on an empty
 * buffer deletes the last committed character. Letters and tones are typed through `typed`.
 */
export const keyDown = (
  state: ImeFieldState,
  { key, composing, modified }: ImeKey,
): ImeKeyOutcome => {
  if (composing || modified) return PASS;
  const choosing = candidatesOf(state).length > 0;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return choosing ? handled(move(state, 1)) : PASS;
    case "ArrowLeft":
    case "ArrowUp":
      return choosing ? handled(move(state, -1)) : PASS;
    case "PageDown":
      return choosing ? handled(turnPage(state, 1)) : PASS;
    case "PageUp":
      return choosing ? handled(turnPage(state, -1)) : PASS;
    case " ":
    case "Enter":
      if (state.buffer !== "") return handled(commit(state, state.active));
      return key === "Enter" ? SUBMIT : handled(state);
    case "Escape":
      return state.buffer === "" ? PASS : handled({ ...state, ...NOT_TYPING });
    case "Backspace":
      return state.buffer === "" && state.committed !== ""
        ? handled({ ...state, committed: Array.from(state.committed).slice(0, -1).join("") })
        : PASS;
    default:
      return PASS;
  }
};

/** The buffer read as syllables: each as typed (ü for v), and the toned ones as a numbered reading. */
export type Composition = { readonly syllables: readonly string[]; readonly toned: string };

export const compositionOf = (buffer: string): Composition => {
  const split = splitPinyin(buffer)[0] ?? [];
  const rest = buffer.slice(split.at(-1)?.end ?? 0);
  return {
    syllables: [
      ...split.map(
        ({ letters, tone }) => `${letters.replace(/v/gu, "ü")}${tone === null ? "" : String(tone)}`,
      ),
      ...(rest === "" ? [] : [rest]),
    ],
    toned: split
      .flatMap(({ letters, tone }) =>
        tone === null ? [] : [`${letters.replace(/v/gu, "u:")}${String(tone)}`],
      )
      .join(" "),
  };
};
