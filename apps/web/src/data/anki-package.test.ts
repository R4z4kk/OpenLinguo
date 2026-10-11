import { openAsBlob } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPackage, type AnkiPackage } from "./anki-package.ts";

const fixture = (name: string): Promise<Blob> =>
  openAsBlob(new URL(`../../fixtures/anki/${name}`, import.meta.url));

const read = async (name: string): Promise<AnkiPackage> => {
  const result = await readPackage(await fixture(name));
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};

const RIFF = [0x52, 0x49, 0x46, 0x46];

/** Exported by Anki itself; see fixtures/anki/README.md. */
const ANKI_EXPORTS = [
  "anki-26.09.3-latest.apkg",
  "anki-26.09.3-legacy2.apkg",
  "anki-23.12.1-latest.apkg",
  "anki-23.12.1-legacy2.apkg",
  "anki-2.1.50-python-exporter.apkg",
];

describe("readPackage", () => {
  it.each(ANKI_EXPORTS)("reads the notes, note types, deck and media of %s", async (name) => {
    const ankiPackage = await read(name);
    expect(ankiPackage.deckName).toBe("HSK test::Level 1");
    expect(
      ankiPackage.noteTypes.map(({ name: noteType, fields }) => ({ noteType, fields })),
    ).toEqual([
      { noteType: "Chinese test", fields: ["Hanzi", "Pinyin", "Meaning", "Audio"] },
      { noteType: "Basic test", fields: ["Front", "Back"] },
    ]);
    const [chinese, basic] = ankiPackage.noteTypes;
    expect(ankiPackage.notes).toHaveLength(9);
    expect(ankiPackage.notes[0]).toEqual({
      guid: expect.stringMatching(/^\S+$/u) as string,
      noteTypeId: chinese?.id,
      fields: ["你好", "nǐ hǎo", "hello", "[sound:nihao.wav]"],
    });
    expect(ankiPackage.notes[8]).toMatchObject({ noteTypeId: basic?.id, fields: ["书", "book"] });
    expect(new Set(ankiPackage.notes.map((note) => note.guid)).size).toBe(9);
    expect([...ankiPackage.media.keys()].sort()).toEqual([
      "chi.js",
      "dianhua.mp3",
      "fake.mp3",
      "nihao.wav",
      "x.png",
      "xiexie.mp3",
      "xuexi.mp3",
    ]);
    const wav = ankiPackage.media.get("nihao.wav");
    if (wav == null) throw new Error("no nihao.wav");
    const bytes = await ankiPackage.read(wav);
    expect(bytes.ok && bytes.value.length).toBe(wav.size);
    expect(bytes.ok && [...bytes.value.subarray(0, 4)]).toEqual(RIFF);
  });

  it("reads a Legacy1 package written by genanki", async () => {
    const ankiPackage = await read("genanki-0.13.1.apkg");
    expect(ankiPackage.deckName).toBe("Genanki deck");
    expect(ankiPackage.noteTypes.map((noteType) => noteType.fields)).toEqual([
      ["Hanzi", "Pinyin", "Meaning", "Audio"],
    ]);
    expect(ankiPackage.notes.map((note) => note.fields[0])).toEqual(["你好", "谢谢"]);
    expect([...ankiPackage.media.keys()]).toEqual(["nihao.mp3"]);
  });

  it("refuses a package version it does not know", async () => {
    expect(await readPackage(await fixture("too-new.apkg"))).toEqual({
      ok: false,
      error: { kind: "too-new", version: 4 },
    });
  });

  it("fails on a package without its collection, or with a corrupt one", async () => {
    expect(await readPackage(await fixture("no-collection.apkg"))).toEqual({
      ok: false,
      error: { kind: "no-collection" },
    });
    const corrupt = await readPackage(await fixture("corrupt-collection.apkg"));
    expect(corrupt.ok || corrupt.error.kind).toBe("corrupt-package");
  });

  it("fails on a file that is not a package", async () => {
    expect(await readPackage(new Blob(["hello"]))).toEqual({
      ok: false,
      error: { kind: "not-zip" },
    });
  });
});
