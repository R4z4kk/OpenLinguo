import { describe, expect, it } from "vitest";
import { err, isErr, isOk, ok, type Result } from "./result.ts";

const divide = (a: number, b: number): Result<number, "division-by-zero"> =>
  b === 0 ? err("division-by-zero") : ok(a / b);

describe("Result", () => {
  it("wraps a success", () => {
    const result = divide(6, 3);
    expect(isOk(result)).toBe(true);
    expect(result).toEqual({ ok: true, value: 2 });
  });

  it("wraps a typed failure", () => {
    const result = divide(1, 0);
    expect(isErr(result)).toBe(true);
    expect(result).toEqual({ ok: false, error: "division-by-zero" });
  });

  it("narrows on the ok flag", () => {
    const result = divide(9, 3);
    const value = result.ok ? result.value : null;
    expect(value).toBe(3);
  });
});
