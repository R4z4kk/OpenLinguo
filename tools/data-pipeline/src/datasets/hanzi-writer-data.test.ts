import { gzipSync } from "node:zlib";
import { err, ok } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import type { ShardReader } from "../run.ts";
import { file, tar, type TarEntry } from "../testing/tar-fixture.ts";
import { hanziWriterData } from "./hanzi-writer-data.ts";

const strokes = (count: number, radStrokes: readonly number[] | null): string =>
  JSON.stringify({
    strokes: Array.from({ length: count }, (_, index) => `M ${String(index)} 0 L 1 1 Z`),
    medians: Array.from({ length: count }, () => [
      [0, 0],
      [1, 1],
    ]),
    ...(radStrokes === null ? {} : { radStrokes }),
  });

const license = file("package/ARPHICPL.TXT", "ARPHIC PUBLIC LICENSE\n");

const archive = (entries: readonly TarEntry[]): Uint8Array => gzipSync(tar([license, ...entries]));

const referentials: ShardReader = (dataset) =>
  Promise.resolve(
    ok(
      dataset === "hsk-2025-chars"
        ? [
            JSON.stringify([
              ["一", 1],
              ["我", 1],
            ]),
          ]
        : [
            JSON.stringify([
              ["一", 1],
              ["丁", 2],
            ]),
          ],
    ),
  );

describe("hanzi-writer-data dataset", () => {
  it("keeps the characters of both referentials and lists missing ones", async () => {
    const built = await hanziWriterData.build(
      archive([
        file("package/一.json", strokes(1, null)),
        file("package/我.json", strokes(2, [1])),
        file("package/人.json", strokes(2, null)),
      ]),
      referentials,
    );
    if (!built.ok) throw new Error(built.error);
    expect(built.value.files.get("strokes-000.json")).toBe(
      '[\n["一",["M 0 0 L 1 1 Z"],[[[0,0],[1,1]]],[]],\n["我",["M 0 0 L 1 1 Z","M 1 0 L 1 1 Z"],[[[0,0],[1,1]],[[0,0],[1,1]]],[1]]\n]\n',
    );
    expect(built.value.files.get("missing.tsv")).toBe("character\n丁\n");
    expect(built.value.files.get("ARPHICPL.TXT")).toBe("ARPHIC PUBLIC LICENSE\n");
    expect(built.value.summary).toBe("2 of 3 HSK 2025 and GF0025-2021 characters, 1 missing");
  });

  it("rejects stroke data whose medians do not match the strokes", async () => {
    const broken = JSON.stringify({ strokes: ["M 0 0 Z"], medians: [] });
    const built = await hanziWriterData.build(
      archive([file("package/一.json", broken)]),
      referentials,
    );
    expect(built).toEqual(err("1 characters with invalid stroke data (一)"));
  });

  it("requires the license file", async () => {
    const built = await hanziWriterData.build(gzipSync(tar([])), referentials);
    expect(built).toEqual(err("package has no ARPHICPL.TXT"));
  });

  it("requires the referentials to be built first", async () => {
    const built = await hanziWriterData.build(archive([]), () => Promise.resolve(ok([])));
    expect(built).toEqual(err("hsk-2025-chars must be built before hanzi-writer-data"));
  });
});
