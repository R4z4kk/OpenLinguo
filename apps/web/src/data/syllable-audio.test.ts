import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.ts";
import { SYLLABLES_BAND, syllableBand, syllableRecordings } from "./syllable-audio.ts";

const row = (id: string, bands: readonly string[]) => ({
  id,
  type: "audio/mpeg",
  data: new ArrayBuffer(1),
  f0: null,
  f0Version: null,
  bands,
});

describe("syllable audio", () => {
  it("finds the chart's band in the pack index", () => {
    const parts = [{ file: "audio-zh-syllables-1-1.zip", bytes: 1, sha256: "0".repeat(64) }];
    const band = { referential: "syllables" as const, level: 1, entries: 1, parts };
    expect(syllableBand({ release: "r", f0: null, bands: [band] })).toBe(band);
    expect(syllableBand({ release: "r", f0: null, bands: [] })).toBeNull();
  });

  it("maps the reading of each recording of the band to its id, word bands left out", async () => {
    const db = openDatabase("syllable-audio");
    await db.wordAudio.bulkPut([
      row("八\tba1", [SYLLABLES_BAND]),
      row("女\tnu:3", ["hsk-2025:1", SYLLABLES_BAND]),
      row("上学\tshang4 xue2", ["hsk-2025:1"]),
    ]);
    const recordings = await syllableRecordings(db);
    expect(recordings.ok && [...recordings.value]).toEqual([
      ["ba1", "八\tba1"],
      ["nu:3", "女\tnu:3"],
    ]);
  });
});
