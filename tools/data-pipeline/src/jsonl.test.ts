import { err, ok } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonLineBytes, parseJsonLines } from "./jsonl.ts";

const Word = z.object({ word: z.string() });
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("parseJsonLines", () => {
  it("validates each non-empty line", () => {
    expect(parseJsonLines('{"word":"字"}\n\n{"word":"词"}\n', Word)).toEqual(
      ok([{ word: "字" }, { word: "词" }]),
    );
  });

  it("numbers the malformed lines", () => {
    expect(parseJsonLines('{"word":"字"}\n{oops\n{"word":1}', Word)).toEqual(
      err("2 malformed lines (2, 3)"),
    );
  });
});

describe("parseJsonLineBytes", () => {
  it("reads the same values from bytes, with or without a final newline", () => {
    expect(parseJsonLineBytes(bytes('{"word":"字"}\n\n{"word":"词"}\n'), Word)).toEqual(
      ok([{ word: "字" }, { word: "词" }]),
    );
    expect(parseJsonLineBytes(bytes('{"word":"字"}'), Word)).toEqual(ok([{ word: "字" }]));
  });

  it("counts a line that is not UTF-8 as malformed, not the whole file", () => {
    const text = bytes('{"word":"字"}\n');
    const invalid = new Uint8Array([...text, 0xe5, 0xad, 0x0a, ...text]);
    expect(parseJsonLineBytes(invalid, Word)).toEqual(err("1 malformed lines (2)"));
  });
});
