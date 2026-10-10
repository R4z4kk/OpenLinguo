import { err, ok } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { decodeMsgpack } from "./msgpack.ts";

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const utf8 = (text: string): number[] => [...new TextEncoder().encode(text)];

describe("decodeMsgpack", () => {
  it("decodes the wordfreq header and buckets", () => {
    // [{"format": "cB", "version": 1}, ["的"], []]
    const header = [0x82, 0xa6, ...utf8("format"), 0xa2, ...utf8("cB")];
    const version = [0xa7, ...utf8("version"), 0x01];
    expect(
      decodeMsgpack(bytes(0x93, ...header, ...version, 0x91, 0xa3, ...utf8("的"), 0x90)),
    ).toEqual(ok([{ format: "cB", version: 1 }, ["的"], []]));
  });

  it("decodes sized strings, arrays, maps and scalars", () => {
    const long = "x".repeat(40);
    expect(decodeMsgpack(bytes(0xd9, 40, ...utf8(long)))).toEqual(ok(long));
    expect(decodeMsgpack(bytes(0xda, 0, 2, ...utf8("ab")))).toEqual(ok("ab"));
    expect(decodeMsgpack(bytes(0xdb, 0, 0, 0, 1, ...utf8("a")))).toEqual(ok("a"));
    expect(decodeMsgpack(bytes(0xdc, 0, 2, 0x01, 0x02))).toEqual(ok([1, 2]));
    expect(decodeMsgpack(bytes(0xdd, 0, 0, 0, 1, 0xc0))).toEqual(ok([null]));
    expect(decodeMsgpack(bytes(0xde, 0, 1, 0xa1, ...utf8("k"), 0xc3))).toEqual(ok({ k: true }));
    expect(decodeMsgpack(bytes(0xdf, 0, 0, 0, 1, 0xa1, ...utf8("k"), 0xc2))).toEqual(
      ok({ k: false }),
    );
    expect(decodeMsgpack(bytes(0xcc, 200))).toEqual(ok(200));
    expect(decodeMsgpack(bytes(0xcd, 1, 0))).toEqual(ok(256));
    expect(decodeMsgpack(bytes(0xce, 0, 1, 0, 0))).toEqual(ok(65_536));
  });

  it("rejects unsupported types, truncated values and trailing bytes", () => {
    expect(decodeMsgpack(bytes(0xca, 0, 0, 0, 0))).toEqual(
      err("invalid MessagePack: TypeError: unsupported type 0xca at byte 0"),
    );
    expect(decodeMsgpack(bytes(0x92, 0x01))).toEqual(
      err("invalid MessagePack: RangeError: truncated at byte 2"),
    );
    expect(decodeMsgpack(bytes(0xdd, 0xff, 0xff, 0xff, 0xff, 0x01))).toEqual(
      err("invalid MessagePack: RangeError: truncated at byte 6"),
    );
    expect(decodeMsgpack(bytes(0x81, 0x01, 0x01))).toEqual(
      err("invalid MessagePack: TypeError: map key is not a string"),
    );
    expect(decodeMsgpack(bytes(0x01, 0x02))).toEqual(err("1 trailing bytes after the value"));
    expect(decodeMsgpack(bytes(0xa2, 0xff, 0xfe)).ok).toBe(false);
  });
});
