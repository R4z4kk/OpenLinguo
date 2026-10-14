import { describe, expect, test } from "vitest";
import { gradeTones } from "./tone-answer.ts";

describe("gradeTones", () => {
  test("every syllable right is good", () => {
    expect(gradeTones([1, 4], [1, 4], [1, 4])).toEqual({
      ok: true,
      value: { grade: "good", correct: [true, true] },
    });
  });

  test("at least half right is hard, less is again", () => {
    expect(gradeTones([1, 4], [1, 4], [1, 2])).toEqual({
      ok: true,
      value: { grade: "hard", correct: [true, false] },
    });
    expect(gradeTones([1, 4, 3], [1, 4, 3], [2, 2, 3])).toEqual({
      ok: true,
      value: { grade: "again", correct: [false, false, true] },
    });
    expect(gradeTones([4], [4], [1])).toEqual({
      ok: true,
      value: { grade: "again", correct: [false] },
    });
  });

  test("the tone spoken after sandhi is as right as the citation tone", () => {
    for (const first of [3, 2]) {
      expect(gradeTones([3, 3], [2, 3], [first, 3])).toEqual({
        ok: true,
        value: { grade: "good", correct: [true, true] },
      });
    }
    expect(gradeTones([3, 3], [2, 3], [1, 3]).ok).toBe(true);
    const wrong = gradeTones([3, 3], [2, 3], [4, 3]);
    expect(wrong.ok && wrong.value.grade).toBe("hard");
  });

  test("the neutral tone is a tone like the others", () => {
    expect(gradeTones([1, 5], [1, 5], [1, 5]).ok).toBe(true);
    const wrong = gradeTones([1, 5], [1, 5], [1, 1]);
    expect(wrong.ok && wrong.value.correct).toEqual([true, false]);
  });

  test("refuses what it cannot grade", () => {
    expect(gradeTones([], [], [])).toEqual({ ok: false, error: { kind: "no-syllable" } });
    expect(gradeTones([1, 2], [1, 2], [1])).toEqual({
      ok: false,
      error: { kind: "length-mismatch" },
    });
    expect(gradeTones([1, 2], [1], [1, 2])).toEqual({
      ok: false,
      error: { kind: "length-mismatch" },
    });
  });
});
