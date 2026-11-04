import { Card, cardKey, err, ok, Review, type Result, type Subject } from "@openlinguo/core";
import { z } from "zod";
import { DeckRow, DeckWordRow, KnownMarkRow, NoteRow } from "./backup.ts";
import { deckWordId } from "./database.ts";
import { knownMarkKey } from "./sync-entities.ts";

export const SYNC_FORMAT = "openlinguo-sync";
export const SYNC_VERSION = 1;

const Header = z.object({ format: z.literal(SYNC_FORMAT), version: z.number().int().min(1) });

/** The two parts of a known mark's key, which throws when the key is not one. */
export const parseKnownMarkKey = (key: string): [string, string] =>
  z.tuple([z.string().min(1), z.string().min(1)]).parse(JSON.parse(key));

/** The deck and subject a deck word's id holds, `null` when the id is not one. */
export const parseDeckWordId = (id: string): { deckId: string; subject: Subject } | null => {
  const [deckId = "", first = "", ...rest] = id.split("\t");
  const subject: Subject =
    first === "" ? { note: rest.join("\t") } : { headword: first, readingKey: rest.join("\t") };
  const row = DeckWordRow.safeParse({ deckId, ...subject });
  return row.success && deckWordId(deckId, subject) === id ? { deckId, subject } : null;
};

const isMarkKey = (key: string): boolean => {
  try {
    parseKnownMarkKey(key);
    return true;
  } catch {
    return false;
  }
};

/**
 * One change of one entity: a value keyed by what it holds, or a deletion of a key of its table.
 * A value's keys come out in the schema's order, so serialized values compare the same everywhere.
 */
const change = <const T extends string, V>(
  table: T,
  value: z.ZodType<V>,
  keyOf: (value: V) => string,
  validKey: (key: string) => boolean,
) =>
  z
    .object({
      table: z.literal(table),
      key: z.string().min(1),
      changedAt: z.number().int().nonnegative(),
      deleted: z.boolean(),
      value: value.nullable(),
    })
    .refine(
      (row) =>
        row.value === null
          ? row.deleted && validKey(row.key)
          : !row.deleted && keyOf(row.value) === row.key,
      { message: "The key and the value disagree" },
    );

export const SyncedEntity = z.discriminatedUnion("table", [
  change(
    "cards",
    Card,
    (card) => card.id,
    (key) => cardKey(key) !== null,
  ),
  change(
    "decks",
    DeckRow,
    (deck) => deck.id,
    (key) => z.uuid().safeParse(key).success,
  ),
  change(
    "deckWords",
    DeckWordRow,
    (word) => deckWordId(word.deckId, word),
    (key) => parseDeckWordId(key) !== null,
  ),
  change(
    "notes",
    NoteRow,
    (note) => note.id,
    () => true,
  ),
  change("knownMarks", KnownMarkRow, knownMarkKey, isMarkKey),
]);
export type SyncedEntity = z.output<typeof SyncedEntity>;

export const SyncChunk = z.object({
  format: z.literal(SYNC_FORMAT),
  version: z.literal(SYNC_VERSION),
  reviews: z.array(Review).superRefine((reviews, context) => {
    const ids = new Set<string>();
    reviews.forEach(({ id }, index) => {
      if (ids.has(id))
        context.addIssue({ code: "custom", path: [index, "id"], message: "Duplicate review id" });
      ids.add(id);
    });
  }),
  entities: z.array(SyncedEntity),
});
export type SyncChunk = z.output<typeof SyncChunk>;

export type ChunkFailure =
  { readonly kind: "unreadable" } | { readonly kind: "newer-format"; readonly version: number };

const piped = (
  bytes: Uint8Array,
  transform: ReadableWritablePair<Uint8Array<ArrayBuffer>, BufferSource>,
): Promise<ArrayBuffer> =>
  new Response(
    new ReadableStream<BufferSource>({
      start: (controller) => {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    }).pipeThrough(transform),
  ).arrayBuffer();

export const encodeChunk = async (chunk: SyncChunk): Promise<Uint8Array> =>
  new Uint8Array(
    await piped(new TextEncoder().encode(JSON.stringify(chunk)), new CompressionStream("gzip")),
  );

const parseJson = async (bytes: Uint8Array): Promise<Result<unknown, null>> => {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      await piped(bytes, new DecompressionStream("gzip")),
    );
    return ok(JSON.parse(text));
  } catch {
    return err(null);
  }
};

export const decodeChunk = async (bytes: Uint8Array): Promise<Result<SyncChunk, ChunkFailure>> => {
  const json = await parseJson(bytes);
  if (!json.ok) return err({ kind: "unreadable" });
  const header = Header.safeParse(json.value);
  if (!header.success) return err({ kind: "unreadable" });
  if (header.data.version > SYNC_VERSION)
    return err({ kind: "newer-format", version: header.data.version });
  const chunk = SyncChunk.safeParse(json.value);
  return chunk.success ? ok(chunk.data) : err({ kind: "unreadable" });
};
