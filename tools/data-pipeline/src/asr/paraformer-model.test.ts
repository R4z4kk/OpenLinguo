import { describe, expect, it } from "vitest";
import { gitBlobSha1, parseSums } from "./paraformer-model.ts";

describe("parseSums", () => {
  it("reads sha256sum lines, text and binary mode", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    expect(parseSums(`${a}  x.mjs\n${b} *y.wasm\n`)).toEqual(
      new Map([
        ["x.mjs", a],
        ["y.wasm", b],
      ]),
    );
  });

  it("refuses anything else", () => {
    expect(() => parseSums("not a hash  x.mjs")).toThrow("not a sha256sum line");
  });
});

describe("gitBlobSha1", () => {
  it("computes git's object id (git hash-object)", () => {
    expect(gitBlobSha1(new TextEncoder().encode("hello\n"))).toBe(
      "ce013625030ba8dba906f756967f9e9ca394464a",
    );
  });
});
