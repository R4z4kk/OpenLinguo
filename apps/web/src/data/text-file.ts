import { err, ok, type Result } from "@openlinguo/core";

/** A text of 20,000 characters is at most 60 KB in UTF-8; this leaves room for a long file to be cut. */
export const MAX_FILE_BYTES = 1_000_000;

export type TextEncoding = "UTF-8" | "UTF-16LE" | "UTF-16BE" | "GB18030";

export type DecodedText = { readonly text: string; readonly encoding: TextEncoding };

export type TextFileFailure =
  | { readonly kind: "too-large"; readonly bytes: number; readonly max: number }
  | { readonly kind: "utf-32" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "empty" };

type Attempt = { readonly text: string | null; readonly encoding: TextEncoding };

/** Control characters other than tab and line breaks: bytes that decode but are not text. */
const hasControl = (text: string): boolean => {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true;
  }
  return false;
};

const startsWith = (data: Uint8Array, prefix: readonly number[]): boolean =>
  prefix.every((value, index) => data[index] === value);

const decode = (label: string, data: Uint8Array): string | null => {
  try {
    return new TextDecoder(label, { fatal: true }).decode(data);
  } catch {
    return null;
  }
};

const attempt = (data: Uint8Array): Attempt => {
  if (startsWith(data, [0xef, 0xbb, 0xbf]))
    return { text: decode("utf-8", data.subarray(3)), encoding: "UTF-8" };
  if (startsWith(data, [0xff, 0xfe]))
    return { text: decode("utf-16le", data.subarray(2)), encoding: "UTF-16LE" };
  if (startsWith(data, [0xfe, 0xff]))
    return { text: decode("utf-16be", data.subarray(2)), encoding: "UTF-16BE" };
  const utf8 = decode("utf-8", data);
  return utf8 === null
    ? { text: decode("gb18030", data), encoding: "GB18030" }
    : { text: utf8, encoding: "UTF-8" };
};

/**
 * A byte-order mark is followed, else strict UTF-8, else GB18030. The encoding is returned for the
 * learner to see: nothing is guessed silently, and bytes that are none of these are refused.
 */
export const decodeTextFile = (data: Uint8Array): Result<DecodedText, TextFileFailure> => {
  if (data.length > MAX_FILE_BYTES)
    return err({ kind: "too-large", bytes: data.length, max: MAX_FILE_BYTES });
  if (startsWith(data, [0xff, 0xfe, 0x00, 0x00]) || startsWith(data, [0x00, 0x00, 0xfe, 0xff]))
    return err({ kind: "utf-32" });
  const { text, encoding } = attempt(data);
  if (text === null || hasControl(text)) return err({ kind: "unreadable" });
  if (text.trim() === "") return err({ kind: "empty" });
  return ok({ text, encoding });
};
