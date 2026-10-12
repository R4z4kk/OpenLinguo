import { err, ok, subjectOf, type NoteKey, type Result, type WordKey } from "@openlinguo/core";
import { matchesPinyin, parsePinyinQuery, searchKey } from "@openlinguo/lang-zh";
import { z } from "zod";
import { readStored, writeStored } from "@/lib/stored";
import type { AnkiFailure, AnkiMedia, AnkiNoteType, AnkiPackage } from "./anki-package.ts";
import {
  deckWordId,
  type Database,
  type NoteContent,
  type StoredAudio,
  type StoredEntry,
} from "./database.ts";
import { checkName, putCards, type DeckNameFailure } from "./decks.ts";
import { guarded, type ReviewLogFailure } from "./review-log.ts";

export const ROLES = ["characters", "pinyin", "meaning", "audio"] as const;
export type Role = (typeof ROLES)[number];

/** Field index per role; a note type whose characters are not mapped is left out. */
export type FieldMapping = Readonly<Record<Role, number | null>>;

/** Media types kept, by file extension; any other media is dropped. */
const AUDIO_TYPES: ReadonlyMap<string, string> = new Map([
  ["mp3", "audio/mpeg"],
  ["ogg", "audio/ogg"],
  ["oga", "audio/ogg"],
  ["opus", "audio/ogg"],
  ["wav", "audio/wav"],
  ["m4a", "audio/mp4"],
  ["aac", "audio/aac"],
  ["flac", "audio/flac"],
  ["webm", "audio/webm"],
]);

export const audioType = (name: string): string | null => {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? null : (AUDIO_TYPES.get(name.slice(dot + 1).toLowerCase()) ?? null);
};

const ENTITIES: ReadonlyMap<string, string> = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
]);

const decodeEntities = (text: string): string =>
  text.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|[a-z]{2,8});/giu, (entity, name: string) => {
    if (!name.startsWith("#")) return ENTITIES.get(name.toLowerCase()) ?? entity;
    const code =
      name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
    return valid ? String.fromCodePoint(code) : entity;
  });

const SOUND = /\[sound:([^\]]+)\]/gu;
const BREAKS = new Set(["br", "div", "p", "li", "tr", "td"]);
const SKIPPED = new Set(["script", "style"]);

/** The plain text of a field: tags, scripts, styles and sounds dropped, entities decoded. */
export const fieldText = (html: string): string => {
  const lower = html.toLowerCase();
  let text = "";
  let at = 0;
  while (at < html.length) {
    const open = html.indexOf("<", at);
    if (open < 0) {
      text += html.slice(at);
      break;
    }
    text += html.slice(at, open);
    const close = html.indexOf(">", open);
    if (close < 0) break;
    const name =
      /^\/?([a-z][a-z\d]*)/iu.exec(html.slice(open + 1, close))?.[1]?.toLowerCase() ?? "";
    at = close + 1;
    if (SKIPPED.has(name) && html[open + 1] !== "/") {
      const end = lower.indexOf(`</${name}`, at);
      const after = end < 0 ? -1 : html.indexOf(">", end);
      at = after < 0 ? html.length : after + 1;
    }
    if (BREAKS.has(name)) text += " ";
  }
  return decodeEntities(text.replace(SOUND, " ")).replace(/\s+/gu, " ").trim();
};

/** The file name of a field's first `[sound:…]`. */
export const soundOf = (html: string): string | null => {
  const name = [...html.matchAll(SOUND)][0]?.[1];
  return name == null ? null : decodeEntities(name).trim().normalize("NFC");
};

const HAN = /\p{Script=Han}/u;

const looksLikePinyin = (text: string): boolean => (parsePinyinQuery(text)?.tones.length ?? 0) > 0;

/** A first mapping read from the notes: sounds, then characters, toned pinyin and any text. */
export const guessMapping = (noteType: AnkiNoteType, ankiPackage: AnkiPackage): FieldMapping => {
  const sample = ankiPackage.notes.filter((note) => note.noteTypeId === noteType.id).slice(0, 20);
  const most = (index: number, test: (html: string) => boolean): boolean =>
    sample.filter((note) => test(note.fields[index] ?? "")).length * 2 > sample.length;
  const taken: number[] = [];
  const pick = (test: (html: string) => boolean): number | null => {
    const index = noteType.fields.findIndex(
      (_, field) => !taken.includes(field) && most(field, test),
    );
    if (index < 0) return null;
    taken.push(index);
    return index;
  };
  const audio = pick((html) => soundOf(html) !== null);
  const characters = pick((html) => HAN.test(fieldText(html)));
  const pinyin = pick((html) => looksLikePinyin(fieldText(html)));
  const meaning = pick((html) => fieldText(html) !== "");
  return { characters, pinyin, meaning, audio };
};

const MAPPINGS_KEY = "openlinguo.ankiFields";

/** Field names per note type id, so a mapping survives fields added or reordered. */
const FieldName = z.string().nullable();
const StoredMappings = z.record(
  z.string(),
  z.object({ characters: FieldName, pinyin: FieldName, meaning: FieldName, audio: FieldName }),
);

const storedMappings = (
  storage: () => Pick<Storage, "getItem">,
): Result<z.output<typeof StoredMappings>, string> => {
  const stored = readStored(storage, MAPPINGS_KEY);
  if (!stored.ok) return stored;
  if (stored.value === null) return ok({});
  let json: unknown;
  try {
    json = JSON.parse(stored.value);
  } catch {
    return ok({});
  }
  const parsed = StoredMappings.safeParse(json);
  return ok(parsed.success ? parsed.data : {});
};

/** The mapping last used for this note type, `null` when none or its fields are gone. */
export const loadMapping = (
  storage: () => Pick<Storage, "getItem">,
  noteType: AnkiNoteType,
): Result<FieldMapping | null, string> => {
  const mappings = storedMappings(storage);
  if (!mappings.ok) return mappings;
  const names = mappings.value[noteType.id];
  if (names == null) return ok(null);
  const indexes = ROLES.map((role) => {
    const name = names[role];
    return name === null ? null : noteType.fields.indexOf(name);
  });
  if (indexes.includes(-1)) return ok(null);
  const [characters = null, pinyin = null, meaning = null, audio = null] = indexes;
  return ok({ characters, pinyin, meaning, audio });
};

/** Remembers the mappings of these note types, keyed by note type id. */
export const saveMappings = (
  storage: () => Pick<Storage, "getItem" | "setItem">,
  noteTypes: readonly AnkiNoteType[],
  mappings: ReadonlyMap<string, FieldMapping>,
): Result<null, string> => {
  const stored = storedMappings(storage);
  if (!stored.ok) return stored;
  const merged = { ...stored.value };
  for (const noteType of noteTypes) {
    const mapping = mappings.get(noteType.id);
    if (mapping == null) continue;
    const named = (role: Role): string | null => {
      const index = mapping[role];
      return index === null ? null : (noteType.fields[index] ?? null);
    };
    merged[noteType.id] = {
      characters: named("characters"),
      pinyin: named("pinyin"),
      meaning: named("meaning"),
      audio: named("audio"),
    };
  }
  return writeStored(storage, MAPPINGS_KEY, JSON.stringify(merged));
};

/** A note's mapped fields as text, and its sound's file name. */
export type NoteText = {
  readonly characters: string;
  readonly pinyin: string;
  readonly meaning: string;
  readonly sound: string | null;
};

export const noteText = (fields: readonly string[], mapping: FieldMapping): NoteText => {
  const field = (role: Role): string => {
    const index = mapping[role];
    return index === null ? "" : (fields[index] ?? "");
  };
  return {
    characters: fieldText(field("characters")).replace(/\s/gu, ""),
    pinyin: fieldText(field("pinyin")),
    meaning: fieldText(field("meaning")),
    sound: soundOf(field("audio")),
  };
};

export type UnmatchedReason = "not-found" | "several-readings" | "pinyin-differs";

export type Unmatched = NoteText & { readonly reason: UnmatchedReason };

export type PlannedAudio = {
  readonly name: string;
  readonly type: string;
  readonly media: AnkiMedia;
};

export type PlannedWord = WordKey & { readonly audio: PlannedAudio | null };

export type PlannedNote = NoteKey & NoteContent & { readonly audio: PlannedAudio | null };

export type ImportPlan = {
  /** Distinct readings, in note order. */
  readonly words: readonly PlannedWord[];
  /** Unmatched notes with a meaning, offered as cards of their own, keyed by guid. */
  readonly notes: readonly PlannedNote[];
  readonly unmatched: readonly Unmatched[];
  /** Notes of note types left out, or with empty characters. */
  readonly ignored: number;
  /** Sounds of matched and offered notes absent from the package. */
  readonly missingAudio: readonly string[];
  /** Media of matched and offered notes that is not audio. */
  readonly notAudio: readonly string[];
};

/** Uncompressed size of the audio to store. */
export const audioBytes = ({ words, notes }: Pick<ImportPlan, "words" | "notes">): number =>
  [...words, ...notes].reduce((sum, item) => sum + (item.audio?.media.size ?? 0), 0);

const wordOf = (entry: StoredEntry): WordKey => ({
  headword: entry.simplified,
  readingKey: entry.id.slice(entry.simplified.length + 1),
});

/**
 * The reading a note stands for. Pinyin narrows the readings of its characters; tones that differ
 * from the dictionary (sandhi spellings such as `yí gè`) still match a single reading by letters.
 */
const chooseReading = (
  readings: readonly StoredEntry[],
  pinyin: string,
): StoredEntry | UnmatchedReason => {
  if (readings.length === 0) return "not-found";
  const query = parsePinyinQuery(pinyin);
  if (query === null)
    return readings.length === 1 && readings[0] ? readings[0] : "several-readings";
  const sameLetters = readings.filter((entry) => searchKey(entry.reading) === query.key);
  const sameTones = sameLetters.filter((entry) => matchesPinyin(entry.reading, query));
  if (sameTones.length === 1 && sameTones[0]) return sameTones[0];
  if (sameLetters.length === 1 && sameLetters[0]) return sameLetters[0];
  return sameLetters.length === 0 ? "pinyin-differs" : "several-readings";
};

/** Matches the mapped notes against the dictionary's simplified and traditional forms. */
export const planImport = (
  db: Database,
  ankiPackage: AnkiPackage,
  mappings: ReadonlyMap<string, FieldMapping>,
): Promise<Result<ImportPlan, ReviewLogFailure>> =>
  guarded(async (): Promise<Result<ImportPlan, never>> => {
    let ignored = 0;
    const notes: (NoteText & { readonly guid: string })[] = [];
    for (const note of ankiPackage.notes) {
      const mapping = mappings.get(note.noteTypeId);
      const text = mapping == null ? null : noteText(note.fields, mapping);
      if (text === null || text.characters === "") ignored += 1;
      else notes.push({ ...text, guid: note.guid });
    }
    const forms = [...new Set(notes.map((note) => note.characters))];
    // One lookup per form: in WebKit, Dexie's `anyOf` walks the whole index (seconds here).
    const found = await db.transaction("r", db.entries, () =>
      Promise.all(
        forms.flatMap((form) => [
          db.entries.where("simplified").equals(form).toArray(),
          db.entries.where("variants").equals(form).toArray(),
        ]),
      ),
    );
    const readingsOf = new Map<string, Map<string, StoredEntry>>();
    for (const row of found.flat()) {
      for (const form of [row.simplified, ...row.variants]) {
        const readings = readingsOf.get(form) ?? new Map<string, StoredEntry>();
        readings.set(row.id, row);
        readingsOf.set(form, readings);
      }
    }

    const words = new Map<string, PlannedWord>();
    const offered = new Map<string, PlannedNote>();
    const unmatched: Unmatched[] = [];
    const missingAudio = new Set<string>();
    const notAudio = new Set<string>();
    const audioOf = (sound: string | null): PlannedAudio | null => {
      if (sound === null) return null;
      const media = ankiPackage.media.get(sound) ?? null;
      const type = audioType(sound);
      if (type === null) notAudio.add(sound);
      else if (media === null) missingAudio.add(sound);
      return media !== null && type !== null ? { name: sound, type, media } : null;
    };
    for (const { guid, ...note } of notes) {
      const chosen = chooseReading(
        [...(readingsOf.get(note.characters)?.values() ?? [])],
        note.pinyin,
      );
      if (typeof chosen === "string") {
        unmatched.push({ ...note, reason: chosen });
        // Without a meaning, the recall card would show nothing.
        if (note.meaning !== "" && guid !== "" && !offered.has(guid)) {
          const { characters, pinyin, meaning } = note;
          offered.set(guid, {
            note: guid,
            characters,
            pinyin,
            meaning,
            audio: audioOf(note.sound),
          });
        }
        continue;
      }
      const audio = audioOf(note.sound);
      const known = words.get(chosen.id);
      if (known == null || (known.audio === null && audio !== null))
        words.set(chosen.id, { ...wordOf(chosen), audio });
    }
    return ok({
      words: [...words.values()],
      notes: [...offered.values()],
      unmatched,
      ignored,
      missingAudio: [...missingAudio],
      notAudio: [...notAudio],
    });
  });

/** Free bytes for this origin, `null` when the browser does not tell. */
export const freeSpace = async (
  storage: Pick<StorageManager, "estimate"> | null,
): Promise<number | null> => {
  if (storage === null) return null;
  try {
    const { quota, usage } = await storage.estimate();
    return quota == null || usage == null ? null : Math.max(0, quota - usage);
  } catch {
    return null;
  }
};

export type ImportedDeck = {
  readonly name: string;
  readonly words: number;
  readonly notes: number;
  readonly audio: number;
};

export type AnkiImportFailure = AnkiFailure | DeckNameFailure;

/**
 * Creates the deck with the cards and audio of its readings and notes in one transaction: nothing
 * is written unless everything is. A note imported again keeps its cards and takes the new
 * content. Audio is read from the package first, outside the transaction.
 */
export const importPlan = async (
  db: Database,
  ankiPackage: AnkiPackage,
  plan: Pick<ImportPlan, "words" | "notes">,
  name: string,
): Promise<Result<ImportedDeck, AnkiImportFailure>> => {
  const deckId = crypto.randomUUID();
  const items = [...plan.words, ...plan.notes];
  const audio: StoredAudio[] = [];
  for (const item of items) {
    if (item.audio === null) continue;
    const bytes = await ankiPackage.read(item.audio.media);
    if (!bytes.ok) return err(bytes.error);
    const data = new ArrayBuffer(bytes.value.byteLength);
    new Uint8Array(data).set(bytes.value);
    audio.push({ id: deckWordId(deckId, item), type: item.audio.type, data });
  }
  const updatedAt = Date.now();
  return guarded(() =>
    db.transaction(
      "rw",
      [db.decks, db.deckWords, db.cards, db.reviews, db.audio, db.notes],
      async (): Promise<Result<ImportedDeck, AnkiImportFailure>> => {
        const checked = await checkName(db, name, null);
        if (!checked.ok) return checked;
        const stored = await putCards(db, items);
        if (!stored.ok) return stored;
        await db.decks.add({ id: deckId, name: checked.value });
        await db.deckWords.bulkAdd(
          items.map((item) => ({ ...subjectOf(item), id: deckWordId(deckId, item), deckId })),
        );
        await db.notes.bulkPut(
          plan.notes.map(({ note, characters, pinyin, meaning }) => ({
            id: note,
            characters,
            pinyin,
            meaning,
            updatedAt,
          })),
        );
        await db.audio.bulkAdd(audio);
        return ok({
          name: checked.value,
          words: plan.words.length,
          notes: plan.notes.length,
          audio: audio.length,
        });
      },
    ),
  );
};

export const isQuotaShort = (
  plan: Pick<ImportPlan, "words" | "notes">,
  free: number | null,
): boolean => free !== null && audioBytes(plan) > free;
