import { err, ok, parseWith, type Result } from "@openlinguo/core";
import type { z } from "zod";

const MAX_REPORTED = 10;
const NEWLINE = 0x0a;

/** Each line, or null when it is not valid UTF-8. */
type Lines = Iterable<string | null>;

const parseLines = <S extends z.ZodType>(
  lines: Lines,
  schema: S,
): Result<readonly z.output<S>[], string> => {
  const values: z.output<S>[] = [];
  const invalid: number[] = [];
  let number = 0;
  for (const line of lines) {
    number += 1;
    if (line?.trim() === "") continue;
    let json: unknown;
    try {
      if (line === null) throw new Error("not UTF-8");
      json = JSON.parse(line);
    } catch {
      invalid.push(number);
      continue;
    }
    const parsed = parseWith(schema, json);
    if (parsed.ok) values.push(parsed.value);
    else invalid.push(number);
  }
  if (invalid.length > 0) {
    const shown = invalid.slice(0, MAX_REPORTED).join(", ");
    return err(`${String(invalid.length)} malformed lines (${shown})`);
  }
  return ok(values);
};

function* linesOf(bytes: Uint8Array): Generator<string | null> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let start = 0;
  while (start < bytes.length) {
    const newline = bytes.indexOf(NEWLINE, start);
    const end = newline === -1 ? bytes.length : newline;
    try {
      yield decoder.decode(bytes.subarray(start, end));
    } catch {
      yield null;
    }
    start = end + 1;
  }
}

/** One JSON value per non-empty line, each validated; any invalid line fails. */
export const parseJsonLines = <S extends z.ZodType>(
  text: string,
  schema: S,
): Result<readonly z.output<S>[], string> => parseLines(text.split("\n"), schema);

/**
 * The same, read from UTF-8 bytes one line at a time: a file past the maximum string length
 * (about 512 MB in V8) is never decoded whole.
 */
export const parseJsonLineBytes = <S extends z.ZodType>(
  bytes: Uint8Array,
  schema: S,
): Result<readonly z.output<S>[], string> => parseLines(linesOf(bytes), schema);
