import type { ApiError } from "@openlinguo/core/api-error";
import {
  LIBRARY_PAGE_SIZE,
  LibraryItem,
  type LibraryPage,
  LibraryQuery,
  LibrarySummary,
} from "@openlinguo/core/submission";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { database, submission } from "./schema.ts";

/** Short enough that a removed text leaves the library within a minute. */
const CACHE_CONTROL = "public, max-age=60";

const refusal = (code: ApiError["code"], message: string): ApiError => ({ code, message });

const published = (row: { readonly publishedAt: Date | null }) => ({
  ...row,
  publishedAt: row.publishedAt?.toISOString() ?? null,
});

const summaryColumns = {
  id: submission.id,
  title: submission.title,
  attribution: submission.attribution,
  origin: submission.origin,
  provenance: submission.provenance,
  licence: submission.licence,
  band: submission.band,
  publishedAt: submission.publishedAt,
};

const approved = eq(submission.status, "approved");

/** `/api/library`: the approved texts, public, no account needed (ADR 0015). */
export const libraryRoutes = () =>
  new Hono<{ Bindings: Env }>()
    .get("/", async (c) => {
      const query = LibraryQuery.safeParse({
        band: c.req.query("band") ?? null,
        page: c.req.query("page") ?? null,
      });
      if (!query.success) {
        const fields = [...new Set(query.error.issues.map(({ path }) => path.join(".")))];
        return c.json(refusal("INVALID_REQUEST", `Invalid fields: ${fields.join(", ")}`), 400);
      }
      const { band } = query.data;
      const page = query.data.page ?? 1;
      const rows = await database(c.env.DB)
        .select(summaryColumns)
        .from(submission)
        .where(band === null ? approved : and(approved, eq(submission.band, band)))
        .orderBy(desc(submission.publishedAt), desc(submission.id))
        .limit(LIBRARY_PAGE_SIZE + 1)
        .offset((page - 1) * LIBRARY_PAGE_SIZE);
      const body: LibraryPage = {
        items: rows.slice(0, LIBRARY_PAGE_SIZE).map((row) => LibrarySummary.parse(published(row))),
        nextPage: rows.length > LIBRARY_PAGE_SIZE ? page + 1 : null,
      };
      c.header("cache-control", CACHE_CONTROL);
      return c.json(body);
    })
    .get("/:id", async (c) => {
      const [row] = await database(c.env.DB)
        .select({ ...summaryColumns, body: submission.body })
        .from(submission)
        .where(and(eq(submission.id, c.req.param("id")), approved));
      if (!row) return c.json(refusal("NOT_FOUND", "No such text in the library"), 404);
      c.header("cache-control", CACHE_CONTROL);
      return c.json(LibraryItem.parse(published(row)));
    });
