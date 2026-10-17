import { err, ok, type ImeCandidate } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import {
  commit,
  compositionOf,
  keyDown,
  lookupInput,
  looked,
  NOT_TYPING,
  turnPage,
  typed,
  type ImeFieldState,
  type ImeKey,
  type ImeKeyOutcome,
} from "./ime-field.ts";

const DIANHUA: readonly [ImeCandidate, ...ImeCandidate[]] = [
  { text: "电话", consumed: 7 },
  { text: "点化", consumed: 7 },
  { text: "点", consumed: 4 },
  { text: "电", consumed: 4 },
];

const typing = (
  buffer: string,
  candidates: readonly [ImeCandidate, ...ImeCandidate[]] | null,
  committed = "",
): ImeFieldState =>
  looked(
    { ...NOT_TYPING, committed, buffer },
    {
      input: buffer,
      candidates: candidates === null ? err({ kind: "no-match", input: buffer }) : ok(candidates),
    },
  );

const many = (count: number): readonly [ImeCandidate, ...ImeCandidate[]] => [
  { text: "一", consumed: 2 },
  ...Array.from({ length: count - 1 }, (_, index) => ({ text: String(index), consumed: 2 })),
];

const press = (key: string, extra: Partial<ImeKey> = {}): ImeKey => ({
  key,
  composing: false,
  modified: false,
  ...extra,
});

const stateOf = (outcome: ImeKeyOutcome): ImeFieldState => {
  if (outcome.kind !== "state") throw new Error(`expected a new state, got ${outcome.kind}`);
  return outcome.state;
};

describe("typed", () => {
  it("keeps letters, apostrophes and tones 1–5 in the buffer", () => {
    expect(typed({ ...NOT_TYPING, committed: "" }, "Xi'an3", false).buffer).toBe("Xi'an3");
    expect(typed({ ...NOT_TYPING, committed: "" }, "lü4 lv4", false).buffer).toBe("lü4lv4");
  });

  it("drops other digits, spaces and punctuation", () => {
    expect(typed({ ...NOT_TYPING, committed: "" }, "ni0 hao9!", false).buffer).toBe("nihao");
  });

  it("commits Han characters as typed, from the system's input method", () => {
    const state = typed({ ...NOT_TYPING, committed: "图书" }, "馆", false);
    expect(state).toMatchObject({ committed: "图书馆", buffer: "" });
  });

  it("leaves the system's composition as it is", () => {
    const state = typed({ ...NOT_TYPING, committed: "" }, "dian hua", true);
    expect(state).toMatchObject({ committed: "", buffer: "dian hua" });
    expect(lookupInput(state)).toBeNull();
  });
});

describe("looked", () => {
  it("drops a lookup for an input that is no longer the buffer", () => {
    const state = { ...NOT_TYPING, committed: "", buffer: "dianh" };
    expect(looked(state, { input: "dian", candidates: ok(DIANHUA) })).toBe(state);
  });

  it("makes the first candidate active", () => {
    expect(typing("dianhua", DIANHUA).active).toBe(0);
  });
});

describe("keyDown", () => {
  it("moves the highlight with the arrows, within the list", () => {
    const right = stateOf(keyDown(typing("dianhua", DIANHUA), press("ArrowRight")));
    expect(right.active).toBe(1);
    expect(stateOf(keyDown(right, press("ArrowDown"))).active).toBe(2);
    expect(stateOf(keyDown(right, press("ArrowLeft"))).active).toBe(0);
    expect(stateOf(keyDown(typing("dianhua", DIANHUA), press("ArrowUp"))).active).toBe(0);
    const last = { ...typing("dianhua", DIANHUA), active: 3 };
    expect(stateOf(keyDown(last, press("ArrowRight"))).active).toBe(3);
  });

  it("leaves the arrows to the caret when there is no candidate", () => {
    expect(keyDown(typing("zh", null), press("ArrowLeft"))).toEqual({ kind: "pass" });
    expect(
      keyDown({ ...typing("dianhua", DIANHUA), buffer: "dianhuaz" }, press("ArrowRight")),
    ).toEqual({
      kind: "pass",
    });
  });

  it("pages with Page Down and Page Up, back to the first page after the last", () => {
    const state = typing("yi", many(20));
    const second = stateOf(keyDown({ ...state, active: 4 }, press("PageDown")));
    expect(second.active).toBe(9);
    expect(stateOf(keyDown(second, press("PageDown"))).active).toBe(18);
    expect(stateOf(keyDown({ ...state, active: 18 }, press("PageDown"))).active).toBe(0);
    expect(stateOf(keyDown(second, press("PageUp"))).active).toBe(0);
    expect(stateOf(keyDown(state, press("PageUp"))).active).toBe(18);
  });

  it("commits the highlighted candidate with Space or Enter, keeping the rest of the buffer", () => {
    const state = { ...typing("dianhua", DIANHUA, "我的"), active: 2 };
    for (const key of [" ", "Enter"]) {
      expect(stateOf(keyDown(state, press(key)))).toEqual({
        committed: "我的点",
        buffer: "hua",
        lookup: null,
        active: 0,
      });
    }
  });

  it("commits the whole buffer when the candidate covers it", () => {
    expect(stateOf(keyDown(typing("dianhua", DIANHUA), press(" ")))).toMatchObject({
      committed: "电话",
      buffer: "",
    });
  });

  it("commits nothing while the lookup is pending or found nothing", () => {
    const pending = { ...typing("dianhua", DIANHUA), buffer: "dianhuab" };
    expect(stateOf(keyDown(pending, press(" ")))).toEqual(pending);
    const none = typing("zh", null, "电");
    expect(stateOf(keyDown(none, press("Enter")))).toEqual(none);
  });

  it("submits on Enter when the buffer is empty", () => {
    expect(keyDown(typing("", null, "电话"), press("Enter"))).toEqual({ kind: "submit" });
    expect(keyDown(typing("", null), press("Enter"))).toEqual({ kind: "submit" });
  });

  it("types no space when the buffer is empty", () => {
    const state = typing("", null, "电话");
    expect(stateOf(keyDown(state, press(" ")))).toEqual(state);
  });

  it("clears the buffer with Escape, and leaves Escape alone when it is empty", () => {
    expect(stateOf(keyDown(typing("dianhua", DIANHUA, "我"), press("Escape")))).toEqual({
      committed: "我",
      ...NOT_TYPING,
    });
    expect(keyDown(typing("", null, "我"), press("Escape"))).toEqual({ kind: "pass" });
  });

  it("leaves Backspace to the input while there is pinyin to edit", () => {
    expect(keyDown(typing("dianhua", DIANHUA, "我"), press("Backspace"))).toEqual({ kind: "pass" });
  });

  it("deletes the last committed character with Backspace on an empty buffer", () => {
    expect(stateOf(keyDown(typing("", null, "图书馆"), press("Backspace"))).committed).toBe("图书");
    expect(stateOf(keyDown(typing("", null, "𠮷"), press("Backspace"))).committed).toBe("");
    expect(keyDown(typing("", null), press("Backspace"))).toEqual({ kind: "pass" });
  });

  it("ignores every key while the system's input method composes", () => {
    const state = typing("dianhua", DIANHUA);
    for (const key of ["ArrowRight", "PageDown", " ", "Enter", "Escape", "Backspace"]) {
      expect(keyDown(state, press(key, { composing: true }))).toEqual({ kind: "pass" });
    }
  });

  it("leaves shortcuts with Alt, Control or Meta to the browser", () => {
    expect(keyDown(typing("dianhua", DIANHUA), press("Enter", { modified: true }))).toEqual({
      kind: "pass",
    });
  });

  it("leaves letters and digits to the input", () => {
    expect(keyDown(typing("dian", DIANHUA), press("h"))).toEqual({ kind: "pass" });
    expect(keyDown(typing("dian", DIANHUA), press("4"))).toEqual({ kind: "pass" });
  });
});

describe("commit", () => {
  it("commits a clicked candidate", () => {
    expect(commit(typing("dianhua", DIANHUA), 3)).toMatchObject({ committed: "电", buffer: "hua" });
  });

  it("ignores a candidate that is not offered", () => {
    const state = typing("dianhua", DIANHUA);
    expect(commit(state, 9)).toBe(state);
  });
});

describe("turnPage", () => {
  it("stays put without candidates", () => {
    const state = typing("zh", null);
    expect(turnPage(state, 1)).toBe(state);
  });
});

describe("compositionOf", () => {
  it("splits the buffer into syllables", () => {
    expect(compositionOf("dianhua")).toEqual({ syllables: ["dian", "hua"], toned: "" });
  });

  it("keeps the tones typed and reads them as a numbered reading", () => {
    expect(compositionOf("guan3")).toEqual({ syllables: ["guan3"], toned: "guan3" });
    expect(compositionOf("lv4hua")).toEqual({ syllables: ["lü4", "hua"], toned: "lu:4" });
  });

  it("keeps what is not a syllable yet as typed", () => {
    expect(compositionOf("nizh")).toEqual({ syllables: ["ni", "zh"], toned: "" });
    expect(compositionOf("zh")).toEqual({ syllables: ["zh"], toned: "" });
  });
});
