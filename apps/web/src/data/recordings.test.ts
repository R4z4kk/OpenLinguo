import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "./database.ts";
import {
  deleteRecording,
  deleteRecordings,
  fromPcm16,
  keepRecording,
  keptRecording,
  keptRecordings,
  toPcm16,
} from "./recordings.ts";

let db: Database;
let count = 0;

beforeEach(() => {
  count += 1;
  db = openDatabase(`recordings-${String(count)}`);
});

const keep = (headword: string, readingKey: string, recordedAt: number, level: number) =>
  keepRecording(db, {
    headword,
    readingKey,
    recordedAt,
    sampleRate: 16_000,
    samples: new Float32Array([level, -level]),
  });

describe("16-bit samples", () => {
  it("clips out-of-range samples and reads back within one step", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]);
    const back = fromPcm16(toPcm16(samples).buffer);
    expect(Array.from(toPcm16(samples))).toEqual([0, 16384, -16383, 32767, -32767, 32767, -32767]);
    for (const [index, sample] of samples.entries()) {
      expect(back[index]).toBeCloseTo(Math.max(-1, Math.min(1, sample)), 4);
    }
  });
});

describe("kept recordings", () => {
  it("keeps one recording per reading: the newest replaces the previous one", async () => {
    expect(await keep("上学", "shang4 xue2", 1, 0.25)).toEqual({ ok: true, value: null });
    await keep("上学", "shang4 xue2", 2, 0.5);
    const kept = await keptRecording(db, "上学\tshang4 xue2");
    expect(kept.ok && kept.value).toMatchObject({
      headword: "上学",
      readingKey: "shang4 xue2",
      recordedAt: 2,
      sampleRate: 16_000,
    });
    expect(kept.ok && kept.value !== null && Array.from(new Int16Array(kept.value.data))).toEqual([
      16384, -16383,
    ]);
    expect(await keptRecording(db, "上\tshang4")).toEqual({ ok: true, value: null });
  });

  it("lists newest first, deletes one, then all", async () => {
    await keep("上学", "shang4 xue2", 1, 0.5);
    await keep("你好", "ni3 hao3", 3, 0.5);
    await keep("好", "hao3", 2, 0.5);
    const listed = await keptRecordings(db);
    expect(listed.ok && listed.value.map(({ headword }) => headword)).toEqual([
      "你好",
      "好",
      "上学",
    ]);

    expect(await deleteRecording(db, "你好\tni3 hao3")).toEqual({ ok: true, value: null });
    const left = await keptRecordings(db);
    expect(left.ok && left.value.map(({ headword }) => headword)).toEqual(["好", "上学"]);

    expect(await deleteRecordings(db)).toEqual({ ok: true, value: null });
    expect(await keptRecordings(db)).toEqual({ ok: true, value: [] });
  });

  it("reports a storage failure instead of throwing", async () => {
    db.close();
    const failed = await keep("上学", "shang4 xue2", 1, 0.5);
    expect(failed).toMatchObject({ ok: false, error: { kind: "storage" } });
  });
});
