import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error.ts";
import { parseWith } from "./validation.ts";

describe("ApiError", () => {
  it("accepts a known code with a message", () => {
    const error = { code: "NOT_FOUND", message: "No route for GET /api/nope" };
    expect(parseWith(ApiError, error)).toEqual({ ok: true, value: error });
  });

  it("refuses an unknown code and a missing message", () => {
    expect(parseWith(ApiError, { code: "TEAPOT", message: "short and stout" }).ok).toBe(false);
    expect(parseWith(ApiError, { code: "INTERNAL" }).ok).toBe(false);
  });
});
