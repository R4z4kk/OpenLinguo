import { describe, expect, it } from "vitest";
import { crc32 } from "node:zlib";
import { storedZip } from "./zip.ts";

/** Reads a stored zip back through its central directory, as the app's reader does. */
const readBack = (zip: Uint8Array): { name: string; bytes: Uint8Array; crc: number }[] => {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = [];
  for (let index = 0; index < count; index++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    expect(view.getUint16(at + 10, true)).toBe(0);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    const local = view.getUint32(at + 42, true);
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true);
    files.push({
      name,
      bytes: zip.subarray(start, start + size),
      crc: view.getUint32(at + 16, true),
    });
    at += 46 + nameLength;
  }
  return files;
};

describe("storedZip", () => {
  it("stores every file with its name, bytes and checksum", () => {
    const audio = new Uint8Array([1, 2, 3, 250]);
    const zip = storedZip([
      { name: "index.json", bytes: new TextEncoder().encode("[]") },
      { name: "一个.mp3", bytes: audio },
    ]);
    if (!zip.ok) throw new Error(zip.error);
    const files = readBack(zip.value);
    expect(files.map(({ name }) => name)).toEqual(["index.json", "一个.mp3"]);
    expect([...(files[1]?.bytes ?? [])]).toEqual([...audio]);
    expect(files[1]?.crc).toBe(crc32(audio));
  });

  it("gives the same bytes for the same files", () => {
    const files = [{ name: "a.mp3", bytes: new Uint8Array([7]) }];
    const first = storedZip(files);
    const second = storedZip(files);
    expect(first.ok && second.ok && Buffer.compare(first.value, second.value)).toBe(0);
  });
});
