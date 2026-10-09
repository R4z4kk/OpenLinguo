import { describe, expect, it } from "vitest";
import { readTar } from "./tar.ts";
import { file, tar } from "./testing/tar-fixture.ts";

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("readTar", () => {
  it("reads regular files, pax paths included, and skips directories", () => {
    const files = readTar(
      tar([
        { name: "package/", content: "", type: "5" },
        file("package/ARPHICPL.TXT", "ARPHIC PUBLIC LICENSE"),
        file("package/我.json", '{"strokes":[]}'),
      ]),
    );
    if (!files.ok) throw new Error(files.error);
    expect([...files.value.keys()]).toEqual(["package/ARPHICPL.TXT", "package/我.json"]);
    expect(text(files.value.get("package/我.json") ?? new Uint8Array())).toBe('{"strokes":[]}');
  });

  it("rejects a corrupted header", () => {
    const archive = tar([file("a.txt", "x")]);
    archive[0] = 0x62;
    expect(readTar(archive)).toEqual({ ok: false, error: "bad header checksum at byte 0" });
  });

  it("rejects a truncated archive", () => {
    const archive = tar([file("a.txt", "x".repeat(600))]);
    expect(readTar(archive.subarray(0, 1024))).toEqual({
      ok: false,
      error: "truncated entry at byte 0",
    });
  });

  it("rejects an archive without its end marker", () => {
    const archive = tar([file("a.txt", "x")]);
    expect(readTar(archive.subarray(0, 1024))).toEqual({
      ok: false,
      error: "archive has no end-of-archive marker",
    });
  });

  it("rejects a malformed pax header", () => {
    const archive = tar([{ name: "PaxHeader/x", content: "99 path=x\n", type: "x" }]);
    expect(readTar(archive)).toEqual({ ok: false, error: "malformed pax header" });
  });
});
