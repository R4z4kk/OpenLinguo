import type {
  AiProvenance,
  Card,
  CardState,
  ReadingChoices,
  Review,
  StrokeData,
  Subject,
  WordKey,
} from "@openlinguo/core";
import { Dexie, type EntityTable, type Table } from "dexie";
import type { AiSettings } from "./ai-settings.ts";
import type { Corrections } from "./correction.ts";
import { DAILY_GOAL } from "./daily-goal.ts";
import type { NameKind } from "./format.ts";
import type { LexiconEntry } from "./lexicon.ts";
import type { Resolution } from "./resolutions.ts";
import type { SearchIndexRecord } from "./search-index.ts";

export type StoredEntry = {
  /** `simplified \t reading key` */
  readonly id: string;
  readonly simplified: string;
  readonly reading: string;
  readonly variants: readonly string[];
  /** Glosses per source, in `GLOSS_SOURCES` order. */
  readonly glosses: readonly [readonly string[], readonly string[], readonly string[]];
  readonly hsk2025: number | null;
  readonly gf0025: number | null;
  /** CC-CEDICT headword, used for segmentation; French-only words are not. */
  readonly lexicon: boolean;
  /** Zipf frequency of the simplified form (wordfreq). */
  readonly frequency: number | null;
};

export type StoredCharacter = {
  readonly character: string;
  readonly decomposition: string;
  readonly radical: string;
  readonly etymology: {
    readonly type: string;
    readonly hint: string | null;
    readonly phonetic: string | null;
    readonly semantic: string | null;
  } | null;
};

export type StoredStrokes = StrokeData & { readonly character: string };

export type MetaRecord =
  | { readonly key: "dataVersion" | "importingVersion"; readonly value: string }
  | { readonly key: "lexicon"; readonly value: readonly string[] };

/** A card with its state replayed from the review log. */
export type StoredCard = Card & CardState;

/** The default personal deck: not stored, named in the interface language. */
export const MY_WORDS = "my-words";

/** A personal deck created by the learner; `id` is a random UUID. */
export type StoredDeck = { readonly id: string; readonly name: string };

/** A reading or a note filed in a personal deck. */
export type StoredDeckWord = Subject & {
  /** `deckId \t headword \t readingKey`, or `deckId \t \t note`: headwords are never empty. */
  readonly id: string;
  readonly deckId: string;
};

export const deckWordId = (deckId: string, subject: Subject): string =>
  "note" in subject
    ? `${deckId}\t\t${subject.note}`
    : `${deckId}\t${subject.headword}\t${subject.readingKey}`;

/** What a note shows, as plain text. */
export type NoteContent = {
  readonly characters: string;
  readonly pinyin: string;
  readonly meaning: string;
};

/** A note's content, kept while a deck holds the note; the latest write wins (ADR 0002). */
export type StoredNote = NoteContent & {
  /** The note key: Anki's guid for an imported note. */
  readonly id: string;
  readonly updatedAt: number;
  /** Set when the content came from an AI answer; kept through edits (docs/compliance/ai.md §4). */
  readonly provenance: AiProvenance | null;
};

/** Audio a deck gives one of its readings or notes, removed with its filing in that deck. */
export type StoredAudio = {
  /** The deck word's id. */
  readonly id: string;
  /** Media type, from the file extension. */
  readonly type: string;
  readonly data: ArrayBuffer;
};

/** A word reading's recording from an audio pack, kept while one of its bands is installed. */
export type StoredWordAudio = {
  /** `headword \t readingKey` */
  readonly id: string;
  readonly type: string;
  readonly data: ArrayBuffer;
  /** Reference pitch contour (core f0.ts), kept for the pitch exercises; null when the pack has none. */
  readonly f0: readonly (number | null)[] | null;
  /** `F0_VERSION` that made `f0`: the contour is used only by the same version. */
  readonly f0Version: string | null;
  /** Installed bands holding it: `hsk-2025:1`. */
  readonly bands: readonly string[];
};

/** The recording the learner kept of a word reading (Say it), one per reading, never in the backup. */
export type StoredRecording = {
  /** `headword \t readingKey`, as in `wordAudio`. */
  readonly id: string;
  readonly headword: string;
  readonly readingKey: string;
  readonly recordedAt: number;
  readonly sampleRate: number;
  /** 16-bit mono samples. */
  readonly data: ArrayBuffer;
};

/** An audio pack band being installed or installed: the parts stored so far, by sha256. */
export type StoredAudioBand = {
  /** `hsk-2025:1` */
  readonly id: string;
  readonly parts: readonly string[];
};

/** A data file fully imported, by content hash. */
export type ImportRecord = { readonly sha256: string };

/** An English Wiktionary word CC-CEDICT lacks: looked up for unknown sequences, never segmented. */
export type StoredExtendedWord = {
  /** `simplified \t traditional \t reading \t part of speech` */
  readonly id: string;
  /** sha256 of the file it was imported from. */
  readonly file: string;
  readonly simplified: string;
  readonly traditional: string;
  readonly reading: string;
  /** `name` marks proper names. */
  readonly pos: string;
  readonly glosses: readonly string[];
};

/** A proper name from jieba's tags: a proposal for unknown sequences, never segmented. */
export type StoredName = {
  /** `word \t kind` */
  readonly id: string;
  /** sha256 of the file it was imported from. */
  readonly file: string;
  readonly word: string;
  readonly kind: NameKind;
};

/** Present once the learner confirmed the AI notice (`seen`) or the Wikidata one; never in the backup. */
export type StoredAiNotice = { readonly id: "seen" | "wikidata" };

/** French glosses an AI translated from an entry's English ones, each with its source. */
export type StoredAiGloss = WordKey & {
  /** `headword \t readingKey`, as in `wordAudio`. */
  readonly id: string;
  readonly senses: readonly { readonly english: string; readonly french: string }[];
  readonly provenance: AiProvenance;
};

/** The AI provider settings: one row, never in the backup (ADR 0012). */
export type StoredAiSettings = AiSettings & { readonly id: string };

/** A learning day's 5-sentence challenge, kept on the device and in the backup (ADR 0012). */
export type StoredChallenge = WordKey & {
  /** The learning day, `YYYY-MM-DD`. */
  readonly day: string;
  /** As typed, empty ones included: one per field. */
  readonly sentences: readonly string[];
  /** One per field, kept while the field's text is the one corrected. */
  readonly corrections: Corrections;
  readonly updatedAt: number;
};

/** A learning day's journal entry, kept on the device and in the backup, never synced (ADR 0012). */
export type StoredJournalEntry = {
  /** The learning day, `YYYY-MM-DD`. */
  readonly day: string;
  /** As typed. */
  readonly text: string;
  /** One per sentence of the text, kept while the sentence is the one corrected. */
  readonly corrections: Corrections;
  readonly updatedAt: number;
};

type StoredTextFields = {
  /** Random UUID. */
  readonly id: string;
  /** The learner's, else the first characters of the text. */
  readonly title: string;
  readonly body: string;
  readonly createdAt: number;
  /** The reading chosen for an occurrence, keyed by the UTF-16 offset of its token. */
  readonly readingChoices: ReadingChoices;
};

/** A text to read, kept on the device and in the backup; a story carries its provenance (ADR 0014). */
export type StoredText = StoredTextFields &
  (
    | { readonly source: "paste" | "file"; readonly provenance: null }
    | { readonly source: "ai"; readonly provenance: AiProvenance }
  );

/** A reading marked « Je connais »: known without a card. */
export type StoredKnownMark = WordKey & { readonly markedAt: number };

/** Version of a dataset downloaded on demand, kept apart from `meta` (cleared by a new dictionary). */
export type OnDemandMetaRecord = { readonly key: "version"; readonly value: string };

export type Database = Dexie & {
  entries: EntityTable<StoredEntry, "id">;
  characters: EntityTable<StoredCharacter, "character">;
  strokes: EntityTable<StoredStrokes, "character">;
  meta: EntityTable<MetaRecord, "key">;
  imports: EntityTable<ImportRecord, "sha256">;
  searchIndex: EntityTable<SearchIndexRecord, "file">;
  // Union rows: `EntityTable` would type inserts with their common fields only.
  cards: Table<StoredCard, string>;
  reviews: EntityTable<Review, "id">;
  decks: EntityTable<StoredDeck, "id">;
  deckWords: Table<StoredDeckWord, string>;
  audio: EntityTable<StoredAudio, "id">;
  notes: EntityTable<StoredNote, "id">;
  extendedWords: EntityTable<StoredExtendedWord, "id">;
  extendedMeta: EntityTable<OnDemandMetaRecord, "key">;
  names: EntityTable<StoredName, "id">;
  namesMeta: EntityTable<OnDemandMetaRecord, "key">;
  wordAudio: EntityTable<StoredWordAudio, "id">;
  audioBands: EntityTable<StoredAudioBand, "id">;
  recordings: EntityTable<StoredRecording, "id">;
  aiNotice: EntityTable<StoredAiNotice, "id">;
  aiSettings: EntityTable<StoredAiSettings, "id">;
  challenges: EntityTable<StoredChallenge, "day">;
  aiGlosses: EntityTable<StoredAiGloss, "id">;
  journal: EntityTable<StoredJournalEntry, "day">;
  texts: EntityTable<StoredText, "id">;
  knownMarks: Table<StoredKnownMark, [string, string]>;
  lexicon: EntityTable<LexiconEntry, "headword">;
  resolutions: Table<Resolution, [string, string]>;
};

export const openDatabase = (name: string): Database => {
  const db = new Dexie(name) as Database;
  db.version(1).stores({
    entries: "id, simplified, *variants",
    characters: "character",
    meta: "key",
    imports: "sha256",
  });
  // Entries imported without frequencies and search index are imported again.
  db.version(2)
    .stores({ searchIndex: "file" })
    .upgrade((tx) => tx.table("meta").bulkDelete(["dataVersion", "importingVersion"]));
  db.version(3).stores({ strokes: "character" });
  // New cards have a null `due`, which IndexedDB leaves out of the index.
  db.version(4).stores({ cards: "id, due", reviews: "id, cardId" });
  // Band decks; ungraded (null) readings stay out of these indexes.
  db.version(5).stores({ entries: "id, simplified, *variants, hsk2025, gf0025" });
  // Personal cards move to « My words ».
  db.version(6)
    .stores({ decks: "id", deckWords: "id, deckId, [headword+readingKey]" })
    .upgrade(async (tx) => {
      const cards = tx.table<WordKey & { readonly personal: boolean }, string>("cards");
      const personal = await cards.filter((card) => card.personal).toArray();
      await tx.table<StoredDeckWord, string>("deckWords").bulkPut(
        personal.map((card) => ({
          id: deckWordId(MY_WORDS, card),
          deckId: MY_WORDS,
          headword: card.headword,
          readingKey: card.readingKey,
        })),
      );
      await cards.toCollection().modify((card) => {
        Reflect.deleteProperty(card, "personal");
      });
    });
  // Reviews made before the goal was stamped count against the default goal.
  db.version(7).upgrade((tx) =>
    tx
      .table<Omit<Review, "dailyGoal">, string>("reviews")
      .toCollection()
      .modify((review) => {
        Object.assign(review, { dailyGoal: DAILY_GOAL.fallback });
      }),
  );
  db.version(8).stores({ audio: "id" });
  db.version(9).stores({ deckWords: "id, deckId, [headword+readingKey], note", notes: "id" });
  db.version(10).stores({ extendedWords: "id, simplified, file", extendedMeta: "key" });
  db.version(11).stores({ names: "id, word, file", namesMeta: "key" });
  db.version(12).stores({ wordAudio: "id, *bands", audioBands: "id" });
  // Contours stored before their version was are of an unknown version: recomputed when needed.
  db.version(13).upgrade((tx) =>
    tx
      .table<Omit<StoredWordAudio, "f0Version">, string>("wordAudio")
      .toCollection()
      .modify((row) => {
        Object.assign(row, { f0Version: null });
      }),
  );
  db.version(14).stores({ recordings: "id" });
  // Notes stored before M5 were written by the learner or imported from Anki.
  db.version(15)
    .stores({ aiNotices: "feature" })
    .upgrade((tx) =>
      tx
        .table<Omit<StoredNote, "provenance">, string>("notes")
        .toCollection()
        .modify((note) => {
          Object.assign(note, { provenance: null });
        }),
    );
  db.version(16).stores({ aiSettings: "id" });
  db.version(17).stores({ challenges: "day" });
  db.version(18).stores({ aiGlosses: "id" });
  // Challenges saved before corrections have none.
  db.version(19).upgrade((tx) =>
    tx
      .table<Omit<StoredChallenge, "corrections">, string>("challenges")
      .toCollection()
      .modify((challenge) => {
        Object.assign(challenge, { corrections: challenge.sentences.map(() => null) });
      }),
  );
  db.version(20).stores({ journal: "day" });
  // One notice for every AI feature replaces the per-feature ones.
  db.version(21).stores({ aiNotices: null, aiNotice: "id" });
  // Reviews logged before words were counted count one each (ADR 0013).
  db.version(22).upgrade((tx) =>
    tx
      .table<Omit<Review, "wordDone">, string>("reviews")
      .toCollection()
      .modify((review) => {
        Object.assign(review, { wordDone: null });
      }),
  );
  db.version(23).stores({ texts: "id, createdAt", knownMarks: "[headword+readingKey]" });
  db.version(24).stores({ lexicon: "headword", resolutions: "[sequence+source], sequence" });
  return db;
};

export const database = openDatabase("openlinguo");
