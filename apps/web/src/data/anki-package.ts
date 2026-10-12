import { err, ok, type Result } from "@openlinguo/core";
import { decompress } from "fzstd";
import { z } from "zod";
import { openSqlite, type SqlRow, type SqliteFailure } from "@/lib/sqlite";
import { openZip, type ZipArchive, type ZipEntry, type ZipFailure } from "@/lib/zip";

export type AnkiTemplate = {
  readonly name: string;
  /** The question side's template, with its `{{Field}}` replacements. */
  readonly front: string;
};

export type AnkiNoteType = {
  readonly id: string;
  readonly name: string;
  readonly fields: readonly string[];
  /** Card templates in order; a cloze note type has one, shared by all its cards. */
  readonly templates: readonly AnkiTemplate[];
};

/** Field values as Anki stores them: HTML. `guid` stays the same across exports of the note. */
export type AnkiNote = {
  readonly id: string;
  readonly guid: string;
  readonly noteTypeId: string;
  readonly fields: readonly string[];
};

/** `ord` is the template's order, or the cloze number minus one. */
export type AnkiCard = { readonly id: string; readonly noteId: string; readonly ord: number };

/**
 * A `revlog` row (rslib/src/revlog/mod.rs): `id` is the answer time in milliseconds, `ease` the
 * button (0 when none), `type` the kind of review and `factor` the ease factor after it.
 */
export type AnkiReview = {
  readonly id: number;
  readonly cardId: string;
  readonly ease: number;
  readonly type: number;
  readonly factor: number;
};

export type AnkiMedia = { readonly entry: ZipEntry; readonly size: number };

export type AnkiPackage = {
  /** The deck the cards were exported from: the deepest deck holding them all. */
  readonly deckName: string | null;
  /** Note types with at least one note, in note order. */
  readonly noteTypes: readonly AnkiNoteType[];
  readonly notes: readonly AnkiNote[];
  readonly cards: readonly AnkiCard[];
  /** The review log of the cards, empty when exported without scheduling. */
  readonly reviews: readonly AnkiReview[];
  /**
   * Whether learning steps had 3 buttons. Anki writes `collection.anki2` with scheduling only from
   * a collection on the v1 scheduler (`_v2sched` in pylib's `AnkiExporter`).
   */
  readonly v1Scheduler: boolean;
  /** Media files present in the package, by name. */
  readonly media: ReadonlyMap<string, AnkiMedia>;
  readonly read: (media: AnkiMedia) => Promise<Result<Uint8Array, AnkiFailure>>;
};

export type AnkiFailure =
  | ZipFailure
  | SqliteFailure
  | { readonly kind: "too-new"; readonly version: number }
  | { readonly kind: "no-collection" }
  | { readonly kind: "corrupt-package"; readonly detail: string };

/**
 * Package versions of Anki's `PackageMetadata` (rslib/src/import_export/package/meta.rs): the
 * latest one compresses the collection and media with zstd and lists media in protobuf.
 */
const COLLECTIONS = new Map([
  [1, "collection.anki2"],
  [2, "collection.anki21"],
  [3, "collection.anki21b"],
]);
const LEGACY1 = 1;
const LATEST = 3;
/** Revlog ids are milliseconds; review ids keep them in 48 bits, until the year 10889. */
const MAX_TIME = 2 ** 48;
const FIELD_SEPARATOR = "\x1f";
const DECK_SEPARATOR = "::";

class PackageError extends Error {
  readonly failure: AnkiFailure;
  constructor(failure: AnkiFailure) {
    super(failure.kind);
    this.failure = failure;
  }
}

const corrupt = (detail: string): never => {
  throw new Error(detail);
};

type ProtoField = { readonly field: number; readonly value: number | Uint8Array };

/**
 * Top-level fields of a protobuf message; fixed-width fields are skipped. Varints take up to 10
 * bytes; past 2^53 they lose precision, as only skipped ids such as a template's get there.
 */
const protoFields = (bytes: Uint8Array): ProtoField[] => {
  const fields: ProtoField[] = [];
  let at = 0;
  const varint = (): number => {
    let value = 0;
    for (let scale = 1; scale < 2 ** 70; scale *= 128) {
      const byte = bytes[at++] ?? corrupt("protobuf cut short");
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) return value;
    }
    return corrupt("protobuf varint too long");
  };
  while (at < bytes.length) {
    const tag = varint();
    const field = Math.floor(tag / 8);
    switch (tag % 8) {
      case 0:
        fields.push({ field, value: varint() });
        break;
      case 1:
        at += 8;
        break;
      case 2: {
        const length = varint();
        fields.push({ field, value: bytes.subarray(at, at + length) });
        at += length;
        break;
      }
      case 5:
        at += 4;
        break;
      default:
        corrupt("protobuf wire type");
    }
  }
  return at === bytes.length ? fields : corrupt("protobuf cut short");
};

const numberField = (fields: readonly ProtoField[], field: number): number | null => {
  const value = fields.findLast((candidate) => candidate.field === field)?.value;
  return typeof value === "number" ? value : null;
};

const bytesField = (fields: readonly ProtoField[], field: number): Uint8Array | null => {
  const value = fields.findLast((candidate) => candidate.field === field)?.value;
  return value instanceof Uint8Array ? value : null;
};

const zstd = (bytes: Uint8Array, what: string): Uint8Array => {
  try {
    return decompress(bytes);
  } catch (error) {
    return corrupt(`${what}: ${String(error)}`);
  }
};

const text = (value: unknown, what: string): string =>
  typeof value === "string" ? value : corrupt(`${what} is not text`);

const integer = (value: unknown, what: string): number =>
  typeof value === "number" ? value : corrupt(`${what} is not a number`);

const id = (value: unknown, what: string): string =>
  typeof value === "number" || typeof value === "bigint"
    ? String(value)
    : corrupt(`${what} is not an id`);

const time = (value: unknown, what: string): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value < MAX_TIME
    ? value
    : corrupt(`${what} is not a time`);

const LegacyNoteTypes = z.record(
  z.string(),
  z.object({
    name: z.string(),
    flds: z.array(z.object({ name: z.string(), ord: z.number().int() })),
    tmpls: z
      .array(z.object({ name: z.string(), ord: z.number().int(), qfmt: z.string().default("") }))
      .default([]),
  }),
);
const LegacyDecks = z.record(z.string(), z.object({ name: z.string() }));

const json = <T>(schema: z.ZodType<T>, value: unknown, what: string): T => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text(value, what));
  } catch {
    return corrupt(`${what} is not JSON`);
  }
  const result = schema.safeParse(parsed);
  return result.success ? result.data : corrupt(`${what} has an unexpected shape`);
};

type Rows = (table: string) => readonly SqlRow[];

type Schema = {
  readonly noteTypes: ReadonlyMap<string, Omit<AnkiNoteType, "id">>;
  readonly decks: ReadonlyMap<string, string>;
};

const byOrd = (a: { readonly ord: number }, b: { readonly ord: number }): number => a.ord - b.ord;

/**
 * Schema 18: `notetypes`, `fields` and `templates` (both WITHOUT ROWID; a template's config is a
 * protobuf whose field 1 is the front) and `decks`, whose names separate levels with 0x1f.
 */
const latestSchema = (rows: Rows): Schema => {
  const fields = Map.groupBy(
    rows("fields").map(({ values: [noteType, ord, name] }) => ({
      noteType: id(noteType, "field note type"),
      ord: integer(ord, "field order"),
      name: text(name, "field name"),
    })),
    (field) => field.noteType,
  );
  const templates = Map.groupBy(
    rows("templates").map(({ values: [noteType, ord, name, , , config] }) => ({
      noteType: id(noteType, "template note type"),
      ord: integer(ord, "template order"),
      name: text(name, "template name"),
      front: new TextDecoder().decode(
        bytesField(
          protoFields(config instanceof Uint8Array ? config : corrupt("template config")),
          1,
        ) ?? new Uint8Array(),
      ),
    })),
    (template) => template.noteType,
  );
  return {
    noteTypes: new Map(
      rows("notetypes").map(({ rowid, values: [, name] }) => {
        const noteType = id(rowid, "note type id");
        return [
          noteType,
          {
            name: text(name, "note type name"),
            fields: (fields.get(noteType) ?? []).sort(byOrd).map((field) => field.name),
            templates: (templates.get(noteType) ?? [])
              .sort(byOrd)
              .map((template) => ({ name: template.name, front: template.front })),
          },
        ];
      }),
    ),
    decks: new Map(
      rows("decks").map(({ rowid, values: [, name] }) => [
        id(rowid, "deck id"),
        text(name, "deck name").replaceAll(FIELD_SEPARATOR, DECK_SEPARATOR),
      ]),
    ),
  };
};

/** Schema 11: note types and decks are JSON in the single `col` row. */
const legacySchema = (rows: Rows): Schema => {
  const [col] = rows("col");
  if (col == null) return corrupt("no collection row");
  const noteTypes = json(LegacyNoteTypes, col.values[9], "note types");
  const decks = json(LegacyDecks, col.values[10], "decks");
  return {
    noteTypes: new Map(
      Object.entries(noteTypes).map(([key, { name, flds, tmpls }]) => [
        key,
        {
          name,
          fields: flds.sort(byOrd).map((field) => field.name),
          templates: tmpls.sort(byOrd).map((template) => ({
            name: template.name,
            front: template.qfmt,
          })),
        },
      ]),
    ),
    decks: new Map(Object.entries(decks).map(([key, deck]) => [key, deck.name])),
  };
};

/** The deepest deck holding every card: `HSK::1` and `HSK::2` give `HSK`. */
const commonDeck = (names: readonly string[]): string | null => {
  const [first, ...rest] = names.map((name) => name.split(DECK_SEPARATOR));
  if (first == null) return null;
  let depth = 0;
  while (depth < first.length && rest.every((other) => other[depth] === first[depth])) depth++;
  return depth === 0 ? null : first.slice(0, depth).join(DECK_SEPARATOR);
};

const legacyMedia = (bytes: Uint8Array): ReadonlyMap<string, string> => {
  const parsed = json(
    z.record(z.string(), z.string()),
    new TextDecoder().decode(bytes),
    "media list",
  );
  return new Map(Object.entries(parsed).map(([entry, name]) => [name, entry]));
};

/** `MediaEntries` (proto/anki/import_export.proto): entry `i` is zip entry `i`, unless renumbered. */
const latestMedia = (bytes: Uint8Array): ReadonlyMap<string, { entry: string; size: number }> =>
  new Map(
    protoFields(bytes)
      .filter((field) => field.field === 1)
      .map((field, index) => {
        const entry =
          field.value instanceof Uint8Array ? protoFields(field.value) : corrupt("media entry");
        const name = new TextDecoder().decode(
          bytesField(entry, 1) ?? corrupt("media entry without name"),
        );
        const entryIndex = numberField(entry, 255) ?? index;
        return [name, { entry: String(entryIndex), size: numberField(entry, 2) ?? 0 }];
      }),
  );

const readEntry = async (archive: ZipArchive, name: string): Promise<Uint8Array | null> => {
  const entry = archive.entries.get(name);
  if (entry == null) return null;
  const bytes = await archive.read(entry);
  if (!bytes.ok) throw new PackageError(bytes.error);
  return bytes.value;
};

const version = async (archive: ZipArchive): Promise<number> => {
  const meta = await readEntry(archive, "meta");
  if (meta !== null) return numberField(protoFields(meta), 1) ?? 0;
  return archive.entries.has("collection.anki21") ? 2 : 1;
};

const parsePackage = async (archive: ZipArchive): Promise<AnkiPackage> => {
  const packageVersion = await version(archive);
  const collectionName = COLLECTIONS.get(packageVersion);
  if (collectionName == null) throw new PackageError({ kind: "too-new", version: packageVersion });
  const latest = packageVersion === LATEST;
  const stored = await readEntry(archive, collectionName);
  if (stored === null) throw new PackageError({ kind: "no-collection" });
  const database = openSqlite(latest ? zstd(stored, "collection") : stored);
  if (!database.ok) throw new PackageError(database.error);
  const rows: Rows = (table) => {
    const result = database.value.rows(table);
    if (!result.ok) throw new PackageError(result.error);
    return result.value;
  };

  const schema = latest ? latestSchema(rows) : legacySchema(rows);
  const notes = rows("notes").map(({ rowid, values }) => ({
    id: id(rowid, "note id"),
    guid: text(values[1], "note guid"),
    noteTypeId: id(values[2], "note type of a note"),
    fields: text(values[6], "note fields").split(FIELD_SEPARATOR),
  }));
  const noteTypes = [...new Set(notes.map((note) => note.noteTypeId))].map((noteTypeId) => {
    const noteType = schema.noteTypes.get(noteTypeId) ?? corrupt(`no note type ${noteTypeId}`);
    return { id: noteTypeId, ...noteType };
  });
  const cardRows = rows("cards");
  const cards = cardRows.map(({ rowid, values }) => ({
    id: id(rowid, "card id"),
    noteId: id(values[1], "note of a card"),
    ord: integer(values[3], "card template"),
  }));
  const deckIds = new Set(cardRows.map(({ values }) => id(values[2], "deck of a card")));
  const deckName = commonDeck([...deckIds].flatMap((deck) => schema.decks.get(deck) ?? []));
  const reviews = rows("revlog").map(({ rowid, values }) => ({
    id: time(rowid, "review id"),
    cardId: id(values[1], "card of a review"),
    ease: integer(values[3], "review button"),
    type: integer(values[8], "review kind"),
    factor: integer(values[6], "review ease factor"),
  }));

  const list = await readEntry(archive, "media");
  const listed =
    list === null
      ? new Map<string, { entry: string; size: number | null }>()
      : latest
        ? latestMedia(zstd(list, "media list"))
        : new Map([...legacyMedia(list)].map(([name, entry]) => [name, { entry, size: null }]));
  const media = new Map<string, AnkiMedia>();
  for (const [name, { entry, size }] of listed) {
    const zipped = archive.entries.get(entry);
    if (zipped != null)
      media.set(name.normalize("NFC"), { entry: zipped, size: size ?? zipped.size });
  }

  const read = async ({ entry, size }: AnkiMedia): Promise<Result<Uint8Array, AnkiFailure>> => {
    const bytes = await archive.read(entry);
    if (!bytes.ok || !latest) return bytes;
    try {
      const data = zstd(bytes.value, entry.name);
      return data.length === size
        ? ok(data)
        : err({ kind: "corrupt-package", detail: `${entry.name} has the wrong size` });
    } catch (error) {
      return err({ kind: "corrupt-package", detail: String(error) });
    }
  };
  return {
    deckName,
    noteTypes,
    notes,
    cards,
    reviews,
    v1Scheduler: packageVersion === LEGACY1,
    media,
    read,
  };
};

/** Reads an `.apkg` file locally: Legacy1 (`collection.anki2`), Legacy2 (`.anki21`) and Latest (`.anki21b`). */
export const readPackage = async (file: Blob): Promise<Result<AnkiPackage, AnkiFailure>> => {
  const archive = await openZip(file);
  if (!archive.ok) return archive;
  try {
    return ok(await parsePackage(archive.value));
  } catch (error) {
    if (error instanceof PackageError) return err(error.failure);
    return err({
      kind: "corrupt-package",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
