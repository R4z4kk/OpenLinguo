import "fake-indexeddb/auto";
import { err, ok } from "@openlinguo/core";
import { beforeEach, describe, expect, it } from "vitest";
import { crc32 } from "@/lib/zip";
import {
  bandStates,
  installBand,
  removeBand,
  wordAudioId,
  type FetchProgress,
} from "./audio-packs.ts";
import { openDatabase, type Database } from "./database.ts";
import type { AudioPackBand, AudioPackIndex } from "./format.ts";
import { sha256 } from "./import.ts";

/** A stored zip in the layout `tts-packs` writes. */
const storedZip = (
  files: readonly { name: string; bytes: Uint8Array }[],
): Uint8Array<ArrayBuffer> => {
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const { name, bytes } of files) {
    const nameBytes = new TextEncoder().encode(name);
    const local = new Uint8Array(30 + nameBytes.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint32(14, crc32(bytes), true);
    header.setUint32(18, bytes.length, true);
    header.setUint32(22, bytes.length, true);
    header.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const central = new Uint8Array(46 + nameBytes.length);
    const entry = new DataView(central.buffer);
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint32(16, crc32(bytes), true);
    entry.setUint32(20, bytes.length, true);
    entry.setUint32(24, bytes.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    parts.push(local, bytes);
    centrals.push(central);
    offset += local.length + bytes.length;
  }
  const size = centrals.reduce((total, central) => total + central.length, 0);
  const end = new Uint8Array(22);
  const trailer = new DataView(end.buffer);
  trailer.setUint32(0, 0x06054b50, true);
  trailer.setUint16(8, files.length, true);
  trailer.setUint16(10, files.length, true);
  trailer.setUint32(12, size, true);
  trailer.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + end.length);
  let at = 0;
  for (const part of [...parts, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

/** `contours` by word; a word without one is written as a pack built before contours existed. */
const pack = (
  words: readonly [word: string, reading: string][],
  contours: ReadonlyMap<string, readonly (number | null)[] | null> = new Map(),
): Uint8Array<ArrayBuffer> =>
  storedZip([
    {
      name: "index.json",
      bytes: new TextEncoder().encode(
        JSON.stringify({
          digitalSourceType:
            "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
          note: "Synthetic voice",
          files: words.map(([word, reading], index) => ({
            file: `${String(index)}.mp3`,
            word,
            reading,
            ...(contours.has(word) ? { f0: contours.get(word) } : {}),
          })),
        }),
      ),
    },
    ...words.map(([word], index) => ({
      name: `${String(index)}.mp3`,
      bytes: new TextEncoder().encode(`mp3 ${word}`),
    })),
  ]);

const band = async (
  referential: AudioPackBand["referential"],
  level: number,
  files: readonly Uint8Array<ArrayBuffer>[],
): Promise<AudioPackBand> => ({
  referential,
  level,
  entries: 2,
  parts: await Promise.all(
    files.map(async (bytes, index) => ({
      file: `audio-zh-${referential}-${String(level)}-${String(index + 1)}.zip`,
      bytes: bytes.length,
      sha256: await sha256(bytes),
    })),
  ),
});

/** Serves the given files; every request is recorded. */
const server = (files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>) => {
  const requested: string[] = [];
  const fetchPart: FetchProgress = (name, _signal, onBytes) => {
    requested.push(name);
    const bytes = files.get(name) ?? null;
    if (bytes === null) return Promise.resolve(err("HTTP 404"));
    onBytes(bytes.length);
    return Promise.resolve(ok(bytes));
  };
  return { requested, fetchPart };
};

const noProgress = (): void => {};
const PACK = { release: "audio-zh-1", f0: "pitchy-4.1.0/v1" };

let db: Database;
let counter = 0;

beforeEach(() => {
  counter++;
  db = openDatabase(`audio-packs-test-${String(counter)}`);
});

describe("audio packs", () => {
  it("stores every recording of a band and reports it installed", async () => {
    const first = pack([["一", "yi1"]]);
    const second = pack([["你好", "ni3 hao3"]]);
    const hsk1 = await band("hsk-2025", 1, [first, second]);
    const { fetchPart } = server(
      new Map([
        [`audio-zh/${hsk1.parts[0]?.file ?? ""}`, first],
        [`audio-zh/${hsk1.parts[1]?.file ?? ""}`, second],
      ]),
    );
    const progress: number[] = [];
    const result = await installBand(
      db,
      PACK,
      hsk1,
      fetchPart,
      (received) => progress.push(received),
      new AbortController().signal,
    );
    expect(result).toEqual(ok(null));
    expect(progress.at(-1)).toBe(first.length + second.length);
    const stored = await db.wordAudio.get(wordAudioId("你好", "ni3 hao3"));
    expect(new TextDecoder().decode(stored?.data)).toBe("mp3 你好");
    expect(stored?.type).toBe("audio/mpeg");
    const index: AudioPackIndex = { ...PACK, bands: [hsk1] };
    const states = await bandStates(db, index);
    expect(states.ok && states.value.get("hsk-2025:1")).toBe("installed");
  });

  it("keeps each recording's pitch contour with its version, null when the pack has none or nothing is voiced", async () => {
    const contours = new Map([
      ["你好", [12, null, -30]],
      ["一", null],
    ]);
    const part = pack(
      [
        ["你好", "ni3 hao3"],
        ["一", "yi1"],
        ["二", "er4"],
      ],
      contours,
    );
    const hsk1 = await band("hsk-2025", 1, [part]);
    const name = `audio-zh/${hsk1.parts[0]?.file ?? ""}`;
    const result = await installBand(
      db,
      PACK,
      hsk1,
      server(new Map([[name, part]])).fetchPart,
      noProgress,
      new AbortController().signal,
    );
    expect(result).toEqual(ok(null));
    const stored = await db.wordAudio.bulkGet([
      wordAudioId("你好", "ni3 hao3"),
      wordAudioId("一", "yi1"),
      wordAudioId("二", "er4"),
    ]);
    expect(stored.map((row) => row?.f0)).toEqual([[12, null, -30], null, null]);
    expect(stored.map((row) => row?.f0Version)).toEqual([PACK.f0, PACK.f0, PACK.f0]);
  });

  it("resumes at the part that failed", async () => {
    const first = pack([["一", "yi1"]]);
    const second = pack([["你好", "ni3 hao3"]]);
    const hsk1 = await band("hsk-2025", 1, [first, second]);
    const firstName = `audio-zh/${hsk1.parts[0]?.file ?? ""}`;
    const secondName = `audio-zh/${hsk1.parts[1]?.file ?? ""}`;
    const broken = await installBand(
      db,
      PACK,
      hsk1,
      server(new Map([[firstName, first]])).fetchPart,
      noProgress,
      new AbortController().signal,
    );
    expect(broken.ok || broken.error.kind).toBe("network");
    const states = await bandStates(db, { ...PACK, bands: [hsk1] });
    expect(states.ok && states.value.get("hsk-2025:1")).toBe("partial");
    const retry = server(
      new Map([
        [firstName, first],
        [secondName, second],
      ]),
    );
    await installBand(db, PACK, hsk1, retry.fetchPart, noProgress, new AbortController().signal);
    expect(retry.requested).toEqual([secondName]);
  });

  it("refuses a part that does not match its sha256", async () => {
    const hsk1 = await band("hsk-2025", 1, [pack([["一", "yi1"]])]);
    const name = `audio-zh/${hsk1.parts[0]?.file ?? ""}`;
    const result = await installBand(
      db,
      PACK,
      hsk1,
      server(new Map([[name, pack([["二", "er4"]])]])).fetchPart,
      noProgress,
      new AbortController().signal,
    );
    expect(result).toEqual(err({ kind: "integrity", file: name }));
    expect(await db.wordAudio.count()).toBe(0);
  });

  it("stops when cancelled", async () => {
    const hsk1 = await band("hsk-2025", 1, [pack([["一", "yi1"]])]);
    const controller = new AbortController();
    const fetchPart: FetchProgress = () => {
      controller.abort();
      return Promise.resolve(err("AbortError"));
    };
    const result = await installBand(db, PACK, hsk1, fetchPart, noProgress, controller.signal);
    expect(result).toEqual(err({ kind: "cancelled" }));
  });

  it("keeps a recording another installed band holds when a band is removed", async () => {
    const hskPack = pack([
      ["一", "yi1"],
      ["你好", "ni3 hao3"],
    ]);
    const gfPack = pack([["一", "yi1"]]);
    const hsk1 = await band("hsk-2025", 1, [hskPack]);
    const gf1 = await band("gf0025-2021", 1, [gfPack]);
    const { fetchPart } = server(
      new Map([
        [`audio-zh/${hsk1.parts[0]?.file ?? ""}`, hskPack],
        [`audio-zh/${gf1.parts[0]?.file ?? ""}`, gfPack],
      ]),
    );
    const signal = new AbortController().signal;
    await installBand(db, PACK, hsk1, fetchPart, noProgress, signal);
    await installBand(db, PACK, gf1, fetchPart, noProgress, signal);
    expect(await removeBand(db, "hsk-2025:1")).toEqual(ok(null));
    expect((await db.wordAudio.toArray()).map(({ id, bands }) => [id, bands])).toEqual([
      [wordAudioId("一", "yi1"), ["gf0025-2021:1"]],
    ]);
    expect(await db.audioBands.get("hsk-2025:1")).toBeUndefined();
  });

  it("replaces a band from an older release", async () => {
    const old = pack([["一", "yi1"]]);
    const current = pack([["二", "er4"]]);
    const signal = new AbortController().signal;
    const oldBand = await band("hsk-2025", 1, [old]);
    await installBand(
      db,
      { release: "audio-zh-0", f0: null },
      oldBand,
      server(new Map([[`audio-zh/${oldBand.parts[0]?.file ?? ""}`, old]])).fetchPart,
      noProgress,
      signal,
    );
    const newBand = await band("hsk-2025", 1, [current]);
    await installBand(
      db,
      PACK,
      newBand,
      server(new Map([[`audio-zh/${newBand.parts[0]?.file ?? ""}`, current]])).fetchPart,
      noProgress,
      signal,
    );
    expect(await db.wordAudio.toCollection().primaryKeys()).toEqual([wordAudioId("二", "er4")]);
  });
});
