import { z } from "zod";

export const ApiErrorCode = z.enum([
  "NOT_FOUND",
  "INTERNAL",
  "UNHEALTHY",
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
  "NOTICE_DECIDED",
  "USE_ACCOUNT_DELETION",
]);
export type ApiErrorCode = z.output<typeof ApiErrorCode>;

/** The body of every error the API answers. */
export const ApiError = z.object({
  code: ApiErrorCode,
  message: z.string().min(1),
});
export type ApiError = z.output<typeof ApiError>;
