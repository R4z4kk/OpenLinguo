import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { crc32, openZip, type ZipArchive } from "./zip.ts";

const fixture = (name: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(readFileSync(new URL(`../../fixtures/anki/${name}`, import.meta.url)));

const LATEST = fixture("anki-26.09.3-latest.apkg");
const LEGACY = fixture("anki-26.09.3-legacy2.apkg");

const opened = async (bytes: Uint8Array<ArrayBuffer>): Promise<ZipArchive> => {
  const zip = await openZip(new Blob([bytes]));
  if (!zip.ok) throw new Error(zip.error.kind);
  return zip.value;
};

const read = async (bytes: Uint8Array<ArrayBuffer>, name: string) => {
  const zip = await opened(bytes);
  const entry = zip.entries.get(name);
  if (entry == null) throw new Error(`no ${name}`);
  return zip.read(entry);
};

const dataStart = async (bytes: Uint8Array<ArrayBuffer>, name: string): Promise<number> => {
  const entry = (await opened(bytes)).entries.get(name);
  if (entry == null) throw new Error(`no ${name}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  return (
    entry.localHeader +
    30 +
    view.getUint16(entry.localHeader + 26, true) +
    view.getUint16(entry.localHeader + 28, true)
  );
};

const SQLITE = new TextEncoder().encode("SQLite format 3\0");

describe("crc32", () => {
  it("matches the IEEE check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("openZip", () => {
  it("lists the entries and reads a stored one", async () => {
    const zip = await opened(LATEST);
    expect([...zip.entries.keys()].slice(0, 4)).toEqual([
      "meta",
      "collection.anki21b",
      "collection.anki2",
      "0",
    ]);
    expect(await read(LATEST, "meta")).toEqual({ ok: true, value: new Uint8Array([8, 3]) });
  });

  it("inflates a deflated entry", async () => {
    const zip = await opened(LEGACY);
    expect(zip.entries.get("collection.anki21")?.method).toBe(8);
    const collection = await read(LEGACY, "collection.anki21");
    expect(collection.ok && collection.value.subarray(0, 16)).toEqual(SQLITE);
  });

  it("finds the end record behind an archive comment", async () => {
    const comment = new TextEncoder().encode("exported by a test");
    const bytes = new Uint8Array(LATEST.length + comment.length);
    bytes.set(LATEST);
    bytes.set(comment, LATEST.length);
    new DataView(bytes.buffer).setUint16(LATEST.length - 2, comment.length, true);
    expect(await read(bytes, "meta")).toEqual({ ok: true, value: new Uint8Array([8, 3]) });
  });

  it("rejects a file that is not an archive, or cut short", async () => {
    expect(await openZip(new Blob(["not a zip"]))).toEqual({
      ok: false,
      error: { kind: "not-zip" },
    });
    expect(await openZip(new Blob([LATEST.subarray(0, LATEST.length - 30)]))).toEqual({
      ok: false,
      error: { kind: "not-zip" },
    });
  });

  it("refuses ZIP64 archives", async () => {
    const bytes = LATEST.slice();
    new DataView(bytes.buffer).setUint16(bytes.length - 22 + 10, 0xffff, true);
    expect(await openZip(new Blob([bytes]))).toEqual({ ok: false, error: { kind: "zip64" } });
  });

  it("fails on a stored entry whose bytes changed", async () => {
    const bytes = LATEST.slice();
    const start = await dataStart(bytes, "collection.anki2");
    bytes[start + 200] = (bytes[start + 200] ?? 0) ^ 0xff;
    expect(await read(bytes, "collection.anki2")).toEqual({
      ok: false,
      error: { kind: "corrupt-zip", detail: "collection.anki2 fails its checksum" },
    });
  });

  it("fails on a broken deflate stream", async () => {
    const bytes = LEGACY.slice();
    const start = await dataStart(bytes, "collection.anki21");
    bytes.fill(0xff, start, start + 64);
    const result = await read(bytes, "collection.anki21");
    expect(result.ok || result.error.kind).toBe("corrupt-zip");
  });

  it("fails on a central directory pointing past the file", async () => {
    const bytes = LATEST.slice();
    new DataView(bytes.buffer).setUint32(bytes.length - 22 + 16, bytes.length, true);
    expect(await openZip(new Blob([bytes]))).toEqual({
      ok: false,
      error: { kind: "corrupt-zip", detail: "central directory out of bounds" },
    });
  });
});
