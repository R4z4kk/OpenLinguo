import { err } from "@openlinguo/core";
import { describe, expect, it } from "vitest";
import { nameText, readNames, renameFont } from "./sfnt.ts";

type NameEntry = readonly [
  platform: number,
  encoding: number,
  language: number,
  id: number,
  text: string,
];

const encode = (platform: number, text: string): number[] =>
  platform === 1
    ? Array.from(text, (char) => char.charCodeAt(0))
    : Array.from(text).flatMap((char) => [char.charCodeAt(0) >> 8, char.charCodeAt(0) & 0xff]);

const u16 = (value: number): number[] => [value >> 8, value & 0xff];

const nameTable = (records: readonly NameEntry[]): Uint8Array => {
  const strings: number[] = [];
  const entries = records.flatMap(([platform, encoding, language, id, text]) => {
    const bytes = encode(platform, text);
    const entry = [platform, encoding, language, id, bytes.length, strings.length].flatMap(u16);
    strings.push(...bytes);
    return entry;
  });
  return new Uint8Array([
    ...u16(0),
    ...u16(records.length),
    ...u16(6 + records.length * 12),
    ...entries,
    ...strings,
  ]);
};

/** A font with these tables, in this order, and zero checksums. */
const sfnt = (tables: readonly (readonly [string, Uint8Array])[], version = 0x00010000) => {
  const directory = 12 + tables.length * 16;
  const size = tables.reduce(
    (total, [, data]) => total + Math.ceil(data.length / 4) * 4,
    directory,
  );
  const font = new Uint8Array(size);
  const view = new DataView(font.buffer);
  view.setUint32(0, version);
  view.setUint16(4, tables.length);
  let offset = directory;
  tables.forEach(([tag, data], index) => {
    font.set(
      Array.from(tag, (char) => char.charCodeAt(0)),
      12 + index * 16,
    );
    view.setUint32(12 + index * 16 + 8, offset);
    view.setUint32(12 + index * 16 + 12, data.length);
    font.set(data, offset);
    offset += Math.ceil(data.length / 4) * 4;
  });
  return font;
};

/** Big-endian 32-bit words, zero-padded. */
const sum = (bytes: Uint8Array): number => {
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
  padded.set(bytes);
  const view = new DataView(padded.buffer);
  let total = 0;
  for (let offset = 0; offset < padded.length; offset += 4) {
    total = (total + view.getUint32(offset)) >>> 0;
  }
  return total;
};

const head = new Uint8Array(54).fill(7);
const glyphs = new Uint8Array([1, 2, 3, 4, 5]);
const font = sfnt([
  ["glyf", glyphs],
  ["head", head],
  [
    "name",
    nameTable([
      [1, 0, 0, 1, "Plangothic P1"],
      [3, 1, 0x409, 0, "Copyright (c) 2024"],
      [3, 1, 0x409, 1, "Plangothic P1"],
      [3, 1, 0x409, 4, "Plangothic P1"],
      [3, 1, 0x409, 16, "Plangothic"],
      [3, 1, 0x804, 1, "遍黑体 P1"],
    ]),
  ],
]);

const names = (bytes: Uint8Array): string[] => {
  const records = readNames(bytes);
  if (!records.ok) throw new Error(records.error);
  return records.value.map(
    (record) =>
      `${String(record.platform)}/${String(record.language)}/${String(record.nameId)}=${nameText(record)}`,
  );
};

describe("renameFont", () => {
  const renamed = renameFont(
    font,
    new Map<number, string | null>([
      [1, "OpenLinguo Han Fallback"],
      [4, "OpenLinguo Han Fallback"],
      [16, null],
    ]),
  );
  if (!renamed.ok) throw new Error(renamed.error);

  it("replaces every record of a renamed id by one Windows English record", () => {
    expect(names(font)).toContain("3/2052/1=遍黑体 P1");
    expect(names(renamed.value)).toEqual([
      "3/1033/0=Copyright (c) 2024",
      "3/1033/1=OpenLinguo Han Fallback",
      "3/1033/4=OpenLinguo Han Fallback",
    ]);
  });

  it("keeps the other tables and writes valid checksums", () => {
    const view = new DataView(renamed.value.buffer);
    const table = (index: number) =>
      renamed.value.subarray(
        view.getUint32(12 + index * 16 + 8),
        view.getUint32(12 + index * 16 + 8) + view.getUint32(12 + index * 16 + 12),
      );
    expect(table(0)).toEqual(glyphs);
    expect(Array.from(table(1).subarray(12))).toEqual(Array.from(head.subarray(12)));
    expect(view.getUint32(12 + 2 * 16 + 4)).toBe(sum(table(2)));
    expect(sum(renamed.value)).toBe(0xb1b0afba);
  });

  it("refuses font collections, other files and fonts without a name table", () => {
    const rename = (bytes: Uint8Array) => renameFont(bytes, new Map([[1, "x"]]));
    expect(rename(sfnt([["head", head]], 0x74746366))).toEqual(
      err("font collections are not supported"),
    );
    expect(rename(new TextEncoder().encode("<!doctype html><html></html>"))).toEqual(
      err("not a TrueType or OpenType font"),
    );
    expect(rename(sfnt([["head", head]]))).toEqual(err("the font has no name table"));
  });
});
