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

describe("ApiErrorCode", () => {
  it("names the account, submission and moderation refusals", () => {
    for (const code of [
      "UNAUTHORIZED",
      "INVALID_REQUEST",
      "AGE_DECLARATION_REQUIRED",
      "SIGNUPS_CLOSED",
      "MAIL_FAILED",
      "TWO_FACTOR_REQUIRED",
      "TOO_MANY_ATTEMPTS",
      "CODE_LIMIT_REACHED",
      "ADMIN_REQUIRED",
      "SUBMISSION_LIMIT",
      "SUBMISSION_NOT_PENDING",
      "SUBMISSION_NOT_APPROVED",
    ]) {
      expect(parseWith(ApiError, { code, message: "refused" }).ok).toBe(true);
    }
  });
});
