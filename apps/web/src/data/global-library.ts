import { ok, parseWith, type Result } from "@openlinguo/core";
import { LibraryItem, LibraryPage, type LibraryQuery } from "@openlinguo/core/submission";
import { type ApiFailure, call } from "./api.ts";
import type { Database, StoredText } from "./database.ts";
import { guarded } from "./review-log.ts";
import { checkDraft, type TextFailure } from "./texts.ts";

export const libraryPath = ({ band, page }: LibraryQuery): string => {
  const query = new URLSearchParams();
  if (band !== null) query.set("band", String(band));
  if (page !== null) query.set("page", String(page));
  const search = query.toString();
  return search === "" ? "/api/library" : `/api/library?${search}`;
};

export const listLibrary = (query: LibraryQuery): Promise<Result<LibraryPage, ApiFailure>> =>
  call(libraryPath(query), { method: "GET" }, (body) => parseWith(LibraryPage, body));

export const loadLibraryItem = (id: string): Promise<Result<LibraryItem, ApiFailure>> =>
  call(`/api/library/${encodeURIComponent(id)}`, { method: "GET" }, (body) =>
    parseWith(LibraryItem, body),
  );

/** Copies a library text into the learner's texts; a copy already there is kept as it is. */
export const importLibraryItem = (
  db: Database,
  item: LibraryItem,
  at: number,
): Promise<Result<StoredText, TextFailure>> =>
  guarded<StoredText, TextFailure>(async () => {
    const existing = (await db.texts.get(item.id)) ?? null;
    if (existing !== null) return ok(existing);
    const checked = checkDraft(item);
    if (!checked.ok) return checked;
    const text: StoredText = {
      id: item.id,
      ...checked.value,
      source: "library",
      createdAt: at,
      provenance: item.provenance,
      readingChoices: {},
      library: {
        licence: item.licence,
        attribution: item.attribution,
        publishedAt: item.publishedAt,
      },
    };
    await db.texts.add(text);
    return ok(text);
  });
