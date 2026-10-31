import { err, ok } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { decodeTextFile, MAX_FILE_BYTES } from "./text-file.ts";

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const concat = (...parts: Uint8Array[]): Uint8Array =>
  Uint8Array.from(parts.flatMap((p) => [...p]));
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const utf16 = (text: string, littleEndian: boolean): Uint8Array => {
  const view = new DataView(new ArrayBuffer(text.length * 2));
  for (let index = 0; index < text.length; index += 1)
    view.setUint16(index * 2, text.charCodeAt(index), littleEndian);
  return new Uint8Array(view.buffer);
};

// 你好 in GB18030: not valid UTF-8.
const GB18030_HELLO = bytes(0xc4, 0xe3, 0xba, 0xc3);

describe("decodeTextFile", () => {
  it("reads strict UTF-8 without a byte-order mark", () => {
    expect(decodeTextFile(utf8("你好，世界。\n"))).toEqual(
      ok({ text: "你好，世界。\n", encoding: "UTF-8" }),
    );
  });

  it("follows a UTF-8 byte-order mark and drops it", () => {
    expect(decodeTextFile(concat(bytes(0xef, 0xbb, 0xbf), utf8("你好")))).toEqual(
      ok({ text: "你好", encoding: "UTF-8" }),
    );
  });

  it("follows a UTF-16 byte-order mark in either order", () => {
    expect(decodeTextFile(concat(bytes(0xff, 0xfe), utf16("你好", true)))).toEqual(
      ok({ text: "你好", encoding: "UTF-16LE" }),
    );
    expect(decodeTextFile(concat(bytes(0xfe, 0xff), utf16("你好", false)))).toEqual(
      ok({ text: "你好", encoding: "UTF-16BE" }),
    );
  });

  it("reads a file that is not valid UTF-8 as GB18030", () => {
    expect(decodeTextFile(GB18030_HELLO)).toEqual(ok({ text: "你好", encoding: "GB18030" }));
  });

  it("does not fall back to GB18030 after a UTF-8 byte-order mark", () => {
    expect(decodeTextFile(concat(bytes(0xef, 0xbb, 0xbf), GB18030_HELLO))).toEqual(
      err({ kind: "unreadable" }),
    );
  });

  it("refuses bytes that are neither UTF-8 nor GB18030", () => {
    expect(decodeTextFile(bytes(0x81, 0x20, 0x81, 0x20))).toEqual(err({ kind: "unreadable" }));
  });

  it("refuses a truncated UTF-16 file", () => {
    expect(decodeTextFile(bytes(0xff, 0xfe, 0x60))).toEqual(err({ kind: "unreadable" }));
  });

  it("refuses binary data that happens to decode", () => {
    expect(decodeTextFile(bytes(0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00))).toEqual(
      err({ kind: "unreadable" }),
    );
  });

  it("names UTF-32, which it does not read", () => {
    expect(decodeTextFile(bytes(0xff, 0xfe, 0x00, 0x00, 0x60, 0x4f, 0x00, 0x00))).toEqual(
      err({ kind: "utf-32" }),
    );
    expect(decodeTextFile(bytes(0x00, 0x00, 0xfe, 0xff, 0x00, 0x00, 0x4f, 0x60))).toEqual(
      err({ kind: "utf-32" }),
    );
  });

  it("refuses an empty file and a file of blanks", () => {
    expect(decodeTextFile(bytes())).toEqual(err({ kind: "empty" }));
    expect(decodeTextFile(utf8(" \r\n\t "))).toEqual(err({ kind: "empty" }));
  });

  it("refuses a file above the size limit without reading it", () => {
    const big = new Uint8Array(MAX_FILE_BYTES + 1).fill(0x61);
    expect(decodeTextFile(big)).toEqual(
      err({ kind: "too-large", bytes: MAX_FILE_BYTES + 1, max: MAX_FILE_BYTES }),
    );
  });
});
