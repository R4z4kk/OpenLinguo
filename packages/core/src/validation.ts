import type { z } from "zod";
import { err, ok, type Result } from "./result.ts";

export type ValidationIssue = { readonly path: string; readonly message: string };

export type ValidationError = {
  readonly kind: "validation";
  readonly issues: readonly ValidationIssue[];
};

export const parseWith = <S extends z.ZodType>(
  schema: S,
  input: unknown,
): Result<z.output<S>, ValidationError> => {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err({
    kind: "validation",
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  });
};
