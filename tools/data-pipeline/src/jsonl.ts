import { err, ok, parseWith, type Result } from "@openlinguo/core";
import type { z } from "zod";

const MAX_REPORTED = 10;

/** One JSON value per non-empty line, each validated; any invalid line fails. */
export const parseJsonLines = <S extends z.ZodType>(
  text: string,
  schema: S,
): Result<readonly z.output<S>[], string> => {
  const values: z.output<S>[] = [];
  const invalid: number[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      invalid.push(index + 1);
      continue;
    }
    const parsed = parseWith(schema, json);
    if (parsed.ok) values.push(parsed.value);
    else invalid.push(index + 1);
  }
  if (invalid.length > 0) {
    const shown = invalid.slice(0, MAX_REPORTED).join(", ");
    return err(`${String(invalid.length)} malformed lines (${shown})`);
  }
  return ok(values);
};
