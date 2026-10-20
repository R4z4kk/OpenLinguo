import {
  cardId,
  CURRENT_SCHEDULER,
  err,
  Grade,
  ok,
  PAIRED_TYPES,
  subjectOf,
  type NoteKey,
  type PairedType,
  type Result,
  type Review,
  type WordKey,
} from "@openlinguo/core";
import { matchesPinyin, parsePinyinQuery, searchKey } from "@openlinguo/lang-zh";
import { z } from "zod";
import { readStored, writeStored } from "@/lib/stored";
import type {
  AnkiFailure,
  AnkiMedia,
  AnkiNoteType,
  AnkiPackage,
  AnkiReview,
} from "./anki-package.ts";
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

/** Template index whose cards give each card type its review history; `null` gives none. */
export type CardMapping = Readonly<Record<PairedType, number | null>>;

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

const TAG = /\{\{([^{}]+)\}\}/gu;

/** The fields a template's front shows: `{{type:Field}}` asks for one instead, a section none. */
export const shownFields = (front: string): ReadonlySet<string> => {
  const shown = new Set<string>();
  for (const [, tag = ""] of front.matchAll(TAG)) {
    const filters = tag.trim().split(":");
    const field = filters.pop()?.trim() ?? "";
    if (!/^[#^/!]/u.test(tag.trim()) && !filters.some((filter) => filter.trim() === "type"))
      shown.add(field);
  }
  return shown;
};

/** Recognition from a front showing the characters without the meaning, recall from the reverse. */
export const guessCards = (noteType: AnkiNoteType, mapping: FieldMapping): CardMapping => {
  const name = (index: number | null): string | null =>
    index === null ? null : (noteType.fields[index] ?? null);
  const find = (shown: string | null, hidden: string | null): number | null => {
    if (shown === null) return null;
    const index = noteType.templates.findIndex(({ front }) => {
      const fields = shownFields(front);
      return fields.has(shown) && (hidden === null || !fields.has(hidden));
    });
    return index < 0 ? null : index;
  };
  const characters = name(mapping.characters);
  const meaning = name(mapping.meaning);
  return { recognition: find(characters, meaning), recall: find(meaning, characters) };
};

const MAPPINGS_KEY = "openlinguo.ankiFields";

/**
 * Field and template names per note type id, so a mapping survives fields or templates added or
 * reordered. Records saved before the review history have no template names.
 */
const FieldName = z.string().nullable();
const StoredMappings = z.record(
  z.string(),
  z.object({
    characters: FieldName,
    pinyin: FieldName,
    meaning: FieldName,
    audio: FieldName,
    cards: z.object({ recognition: FieldName, recall: FieldName }).nullable().default(null),
  }),
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

/** The card mapping last used for this note type, `null` when none or its templates are gone. */
export const loadCards = (
  storage: () => Pick<Storage, "getItem">,
  noteType: AnkiNoteType,
): Result<CardMapping | null, string> => {
  const mappings = storedMappings(storage);
  if (!mappings.ok) return mappings;
  const names = mappings.value[noteType.id]?.cards ?? null;
  if (names === null) return ok(null);
  const index = (name: string | null): number | null =>
    name === null ? null : noteType.templates.findIndex((template) => template.name === name);
  const recognition = index(names.recognition);
  const recall = index(names.recall);
  return ok(recognition === -1 || recall === -1 ? null : { recognition, recall });
};

/** Remembers the mappings of these note types, keyed by note type id. */
export const saveMappings = (
  storage: () => Pick<Storage, "getItem" | "setItem">,
  noteTypes: readonly AnkiNoteType[],
  mappings: ReadonlyMap<string, FieldMapping>,
  cardMappings: ReadonlyMap<string, CardMapping> = new Map(),
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
    const cards = cardMappings.get(noteType.id) ?? null;
    const template = (type: PairedType): string | null => {
      const index = cards?.[type] ?? null;
      return index === null ? null : (noteType.templates[index]?.name ?? null);
    };
    merged[noteType.id] = {
      characters: named("characters"),
      pinyin: named("pinyin"),
      meaning: named("meaning"),
      audio: named("audio"),
      cards:
        cards === null
          ? (merged[noteType.id]?.cards ?? null)
          : { recognition: template("recognition"), recall: template("recall") },
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

/** `noteIds`: the Anki notes it comes from, in note order. */
export type PlannedWord = WordKey & {
  readonly audio: PlannedAudio | null;
  readonly noteIds: readonly string[];
};

export type PlannedNote = NoteKey &
  NoteContent & { readonly audio: PlannedAudio | null; readonly noteIds: readonly string[] };

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
    const notes: (NoteText & { readonly id: string; readonly guid: string })[] = [];
    for (const note of ankiPackage.notes) {
      const mapping = mappings.get(note.noteTypeId);
      const text = mapping == null ? null : noteText(note.fields, mapping);
      if (text === null || text.characters === "") ignored += 1;
      else notes.push({ ...text, id: note.id, guid: note.guid });
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
    for (const { id, guid, ...note } of notes) {
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
            noteIds: [id],
          });
        }
        continue;
      }
      const audio = audioOf(note.sound);
      const known = words.get(chosen.id);
      words.set(chosen.id, {
        ...wordOf(chosen),
        audio: known?.audio ?? audio,
        noteIds: [...(known?.noteIds ?? []), id],
      });
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

/** Revlog kinds (rslib/src/revlog/mod.rs); manual (4) and rescheduled (5) entries are no answers. */
const LEARNING = 0;
const REVIEW = 1;
const RELEARNING = 2;
const FILTERED = 3;
const MANUAL = 4;
const ANSWERS: ReadonlySet<number> = new Set([LEARNING, REVIEW, RELEARNING, FILTERED]);

/** An answer kept from an Anki card's log; `at` is its revlog id. */
export type AnkiAnswer = { readonly at: number; readonly grade: Grade };

/**
 * Buttons 1 to 4 are again, hard, good and easy. On the v1 scheduler, learning and relearning
 * steps had 3 buttons, again, good and easy, which Anki shifts when it upgrades a collection
 * (rslib/src/storage/revlog/v2_upgrade.sql). `null` when no button was chosen.
 */
export const ankiGrade = (
  { ease, type }: Pick<AnkiReview, "ease" | "type">,
  v1Scheduler: boolean,
): Grade | null => {
  const threeButtons = v1Scheduler && (type === LEARNING || type === RELEARNING);
  const button = threeButtons && (ease === 2 || ease === 3) ? ease + 1 : ease;
  return Grade.options[button - 1] ?? null;
};

/** A preview in a filtered deck without rescheduling leaves the card as it was. */
const isCramming = (review: AnkiReview): boolean => review.type === FILTERED && review.factor === 0;

/** "Forget" makes the card new again. */
const isReset = (review: AnkiReview): boolean => review.type === MANUAL && review.factor === 0;

/**
 * The answers that still describe an Anki card, oldest first, as Anki's FSRS reads its log
 * (rslib/src/scheduler/fsrs/params.rs, `reviews_for_fsrs`): from its last group of learning
 * steps, or else after its last reset. Manual entries (due date set, rescheduled, reset) and
 * cramming are left out.
 */
export const cardHistory = (
  log: readonly AnkiReview[],
  v1Scheduler: boolean,
): readonly AnkiAnswer[] => {
  const entries = log.toSorted((a, b) => a.id - b.id);
  let start = 0;
  let learning: number | null = null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry == null || isCramming(entry)) continue;
    if (entry.type === LEARNING && entry.ease > 0) learning = index;
    else if (isReset(entry)) {
      start = index + 1;
      break;
    } else if (learning !== null) break;
  }
  return entries.slice(learning ?? start).flatMap((entry) => {
    const grade =
      ANSWERS.has(entry.type) && !isCramming(entry) ? ankiGrade(entry, v1Scheduler) : null;
    return grade === null ? [] : [{ at: entry.id, grade }];
  });
};

/** An answer from Anki for one of the imported cards. */
export type PlannedReview = AnkiAnswer & { readonly cardId: string };

/**
 * The history each card of the chosen readings and notes takes from the Anki card of the template
 * mapped to its type. When several notes give a reading, its card takes the longest history, so
 * two logs never interleave; a cloze note type's cards share its one template.
 */
export const planHistory = (
  ankiPackage: AnkiPackage,
  items: readonly (PlannedWord | PlannedNote)[],
  cardMappings: ReadonlyMap<string, CardMapping>,
): readonly PlannedReview[] => {
  const notes = new Map(ankiPackage.notes.map((note) => [note.id, note]));
  const noteTypes = new Map(ankiPackage.noteTypes.map((noteType) => [noteType.id, noteType]));
  const cards = Map.groupBy(ankiPackage.cards, (card) => card.noteId);
  const logs = Map.groupBy(ankiPackage.reviews, (review) => review.cardId);
  return items.flatMap((item) =>
    PAIRED_TYPES.flatMap((type) => {
      let longest: readonly AnkiAnswer[] = [];
      for (const noteId of item.noteIds) {
        const noteType = noteTypes.get(notes.get(noteId)?.noteTypeId ?? "") ?? null;
        const template = noteType === null ? null : (cardMappings.get(noteType.id)?.[type] ?? null);
        if (noteType === null || template === null) continue;
        for (const card of cards.get(noteId) ?? []) {
          if ((noteType.templates.length === 1 ? 0 : card.ord) !== template) continue;
          const history = cardHistory(logs.get(card.id) ?? [], ankiPackage.v1Scheduler);
          if (history.length > longest.length) longest = history;
        }
      }
      const id = cardId({ ...subjectOf(item), language: "zh", type });
      return longest.map((answer) => ({ ...answer, cardId: id }));
    }),
  );
};

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * A UUIDv8 (RFC 9562): the answer time, the revlog id, in its first 48 bits, then 74 bits of the
 * card id's SHA-256. The same Anki answer for the same card always gets the same id.
 */
export const reviewId = (at: number, cardHash: Uint8Array): string => {
  const bytes = cardHash.slice(0, 16);
  let time = at;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = 0x80 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const digits = hex(bytes);
  return [
    digits.slice(0, 8),
    digits.slice(8, 12),
    digits.slice(12, 16),
    digits.slice(16, 20),
    digits.slice(20),
  ].join("-");
};

/** Local time minus UTC at a time, in this device's time zone. */
export const deviceOffset = (at: number): number => -new Date(at).getTimezoneOffset();

/**
 * The answers as review log entries. Anki does not record the time zone of an answer: it is dated
 * with `utcOffset`, this device's. Each takes the current daily goal and counts toward it on its
 * own, so a past day is met when its answers reached it.
 */
export const historyReviews = async (
  planned: readonly PlannedReview[],
  dailyGoal: number,
  utcOffset: (at: number) => number,
): Promise<readonly Review[]> => {
  const encoder = new TextEncoder();
  const logs = await Promise.all(
    [...Map.groupBy(planned, (review) => review.cardId)].map(async ([id, answers]) => {
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(id)));
      return answers.map(({ at, grade }) => ({
        id: reviewId(at, hash),
        cardId: id,
        grade,
        reviewedAt: at,
        utcOffsetMinutes: utcOffset(at),
        scheduler: CURRENT_SCHEDULER,
        dailyGoal,
        wordDone: null,
      }));
    }),
  );
  return logs.flat();
};

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
  /** Reviews added to the log; those already in it are not counted. */
  readonly reviews: number;
};

export type AnkiImportFailure = AnkiFailure | DeckNameFailure;

/**
 * Creates the deck with the cards and audio of its readings and notes, and logs their reviews, in
 * one transaction: nothing is written unless everything is. A note imported again keeps its cards
 * and takes the new content; a review already logged is skipped, and every card gaining reviews
 * is replayed from its merged log. Audio is read from the package first, outside the transaction.
 */
export const importPlan = async (
  db: Database,
  ankiPackage: AnkiPackage,
  plan: Pick<ImportPlan, "words" | "notes">,
  name: string,
  reviews: readonly Review[] = [],
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
        const stored = await putCards(db, items, reviews);
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
            provenance: null,
          })),
        );
        await db.audio.bulkAdd(audio);
        return ok({
          name: checked.value,
          words: plan.words.length,
          notes: plan.notes.length,
          audio: audio.length,
          reviews: stored.value,
        });
      },
    ),
  );
};

export const isQuotaShort = (
  plan: Pick<ImportPlan, "words" | "notes">,
  free: number | null,
): boolean => free !== null && audioBytes(plan) > free;
