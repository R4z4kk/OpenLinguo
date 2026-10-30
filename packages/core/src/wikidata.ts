import { z } from "zod";
import { eitherSignal } from "./abort.ts";
import type { DatedFact } from "./ai-marking.ts";
import { err, ok, type Result } from "./result.ts";
import { parseWith, type ValidationError } from "./validation.ts";

/**
 * The old service may degrade from February 2027 and v2 (query-next.wikidata.org) is not public yet;
 * read both pages again before `reviewBy`, and docs/compliance/wikidata.md with them.
 * Limits: 60 s per query, 60 s of processing per minute per client, 5 parallel queries per IP, 429
 * with Retry-After (https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual).
 */
export const WIKIDATA_ENDPOINT = {
  value: "https://query.wikidata.org/sparql",
  source: "https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/WDQS_backend_update",
  checkedOn: "2026-10-21",
  reviewBy: "2027-01-15",
} as const satisfies DatedFact;

/** Wikimedia User-Agent policy: `<client name> (<contact>)`, sent as Api-User-Agent from a browser. */
const USER_AGENT = "OpenLinguo (https://github.com/R4z4kk/OpenLinguo)";

const BATCH_SIZE = 50;
const MAX_SEQUENCE_LENGTH = 30;
// The service answers 431 above 8 KiB of request headers: measured 2026-10-21, a 6,753-character
// URL got 200 and a 7,653-character one 431, and a browser adds about 700 bytes of its own headers.
const MAX_URL_LENGTH = 6_000;
const CALL_LIMIT_MS = 60_000;

const PERSON = "Q5";
const DISAMBIGUATION_PAGE = "Q4167410";
// Direct P31 only, labels read on 2026-10-21: organization, business, enterprise, university,
// public university, political party, international organization, nonprofit organization.
const ORGANIZATION_CLASSES: ReadonlySet<string> = new Set([
  "Q43229",
  "Q4830453",
  "Q6881511",
  "Q3918",
  "Q875538",
  "Q7278",
  "Q484652",
  "Q163740",
]);

export type WikidataKind = "person" | "organization" | "place" | "other";

export type WikidataCandidate = {
  readonly id: string;
  readonly kind: WikidataKind;
  readonly descriptionFr: string | null;
  readonly descriptionEn: string | null;
};

/** One sequence that was checked; no candidate means nothing was found. */
export type WikidataResult = {
  readonly sequence: string;
  readonly candidates: readonly WikidataCandidate[];
};

export type WikidataErrorKind =
  | "invalid-input"
  | "network"
  | "rate-limited"
  | "timeout"
  | "server"
  | "invalid-response"
  | "aborted";

export type WikidataError = {
  readonly kind: WikidataErrorKind;
  readonly status: number | null;
  readonly message: string | null;
};

export type WikidataRequest = {
  readonly sequences: readonly string[];
  readonly fetch: typeof fetch;
  readonly signal: AbortSignal;
};

/** `checked` holds the sequences of the requests that succeeded; after an error, the rest were not sent. */
export type WikidataLookup = {
  readonly checked: readonly WikidataResult[];
  readonly error: WikidataError | null;
};

const UNSAFE = /["\\\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u;

/** Whether the sequence can be written in the query as a string literal, and fits the URL. */
export const isWikidataSequence = (sequence: string): boolean =>
  sequence !== "" && Array.from(sequence).length <= MAX_SEQUENCE_LENGTH && !UNSAFE.test(sequence);

const term = (sequence: string): string => `"${sequence}"@zh "${sequence}"@zh-hans`;

const queryOf = (
  sequences: readonly string[],
): string => `SELECT ?s ?item ?class ?coord ?fr ?en WHERE {
  VALUES ?s { ${sequences.map(term).join(" ")} }
  { ?item rdfs:label ?s } UNION { ?item skos:altLabel ?s }
  OPTIONAL { ?item wdt:P31 ?class }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item schema:description ?fr FILTER(LANG(?fr) = "fr") }
  OPTIONAL { ?item schema:description ?en FILTER(LANG(?en) = "en") }
}`;

const urlOf = (sequences: readonly string[]): string =>
  `${WIKIDATA_ENDPOINT.value}?query=${encodeURIComponent(queryOf(sequences))}`;

const BASE_LENGTH = urlOf([]).length;

/** At most 50 sequences per request, and fewer when the URL would get too long. */
const batchesOf = (sequences: readonly string[]): readonly (readonly string[])[] => {
  const batches: string[][] = [];
  let batch: string[] = [];
  let length = BASE_LENGTH;
  for (const sequence of sequences) {
    const cost = encodeURIComponent(`${term(sequence)} `).length;
    if (batch.length === BATCH_SIZE || (batch.length > 0 && length + cost > MAX_URL_LENGTH)) {
      batches.push(batch);
      batch = [];
      length = BASE_LENGTH;
    }
    batch.push(sequence);
    length += cost;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
};

const ENTITY_PREFIX = "http://www.wikidata.org/entity/";
const entityId = z
  .string()
  .regex(/^http:\/\/www\.wikidata\.org\/entity\/Q\d+$/u)
  .transform((uri) => uri.slice(ENTITY_PREFIX.length));

const optional = <S extends z.ZodType>(schema: S) => schema.nullable().catch(null);
const text = z.object({ value: z.string() });

const Answer = z.object({
  results: z.object({
    bindings: z.array(
      z.object({
        s: text,
        item: z.object({ value: entityId }),
        class: optional(z.object({ value: entityId })),
        coord: optional(text),
        fr: optional(text),
        en: optional(text),
      }),
    ),
  }),
});

type Binding = z.output<typeof Answer>["results"]["bindings"][number];

type Item = {
  readonly classes: Set<string>;
  coord: boolean;
  fr: string | null;
  en: string | null;
};

const kindOf = (item: Item): WikidataKind => {
  if (item.classes.has(PERSON)) return "person";
  if ([...item.classes].some((id) => ORGANIZATION_CLASSES.has(id))) return "organization";
  return item.coord ? "place" : "other";
};

const rankOf = ({ descriptionFr, descriptionEn }: WikidataCandidate): number =>
  descriptionFr !== null ? 0 : descriptionEn !== null ? 1 : 2;

/** Rows come once per label language and per class: merge them by item. */
const candidatesOf = (bindings: readonly Binding[]): readonly WikidataCandidate[] => {
  const items = new Map<string, Item>();
  for (const row of bindings) {
    const item = items.get(row.item.value) ?? {
      classes: new Set<string>(),
      coord: false,
      fr: null,
      en: null,
    };
    if (row.class !== null) item.classes.add(row.class.value);
    item.coord ||= row.coord !== null;
    item.fr ??= row.fr?.value ?? null;
    item.en ??= row.en?.value ?? null;
    items.set(row.item.value, item);
  }
  return [...items]
    .filter(([, item]) => !item.classes.has(DISAMBIGUATION_PAGE))
    .map(([id, item]) => ({
      id,
      kind: kindOf(item),
      descriptionFr: item.fr,
      descriptionEn: item.en,
    }))
    .sort((a, b) => rankOf(a) - rankOf(b));
};

const failure = (kind: WikidataErrorKind, status: number | null, message: string | null) =>
  err<WikidataError>({ kind, status, message });

const invalid = (status: number, error: ValidationError | string) =>
  failure(
    "invalid-response",
    status,
    typeof error === "string"
      ? error
      : error.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
  );

const parseJson = (body: string): Result<unknown, string> => {
  try {
    const value: unknown = JSON.parse(body);
    return ok(value);
  } catch {
    return err("The response is not JSON.");
  }
};

/** One GET; a 429 and a network error are returned, never retried. */
const queryBatch = async (
  batch: readonly string[],
  request: WikidataRequest,
): Promise<Result<readonly WikidataResult[], WikidataError>> => {
  const limit = new AbortController();
  const timer = setTimeout(() => {
    limit.abort();
  }, CALL_LIMIT_MS);
  const { signal, release } = eitherSignal(request.signal, limit.signal);
  let status: number;
  let body: string;
  try {
    const { fetch: send } = request;
    const response = await send(urlOf(batch), {
      method: "GET",
      headers: { Accept: "application/sparql-results+json", "Api-User-Agent": USER_AGENT },
      referrerPolicy: "no-referrer",
      credentials: "omit",
      signal,
    });
    status = response.status;
    body = await response.text();
  } catch {
    if (request.signal.aborted) return failure("aborted", null, null);
    return failure(limit.signal.aborted ? "timeout" : "network", null, null);
  } finally {
    clearTimeout(timer);
    release();
  }
  if (status === 429) return failure("rate-limited", status, null);
  if (status < 200 || status > 299) return failure("server", status, null);
  const json = parseJson(body);
  if (!json.ok) return invalid(status, json.error);
  const answer = parseWith(Answer, json.value);
  if (!answer.ok) return invalid(status, answer.error);
  return ok(
    batch.map((sequence) => ({
      sequence,
      candidates: candidatesOf(
        answer.value.results.bindings.filter((row) => row.s.value === sequence),
      ),
    })),
  );
};

/**
 * Looks the sequences up on Wikidata, one request per 50, one after the other, stopping at the first
 * error. Nothing is cached or retried here.
 */
export const lookupWikidata = async (request: WikidataRequest): Promise<WikidataLookup> => {
  if (!request.sequences.every(isWikidataSequence)) {
    return {
      checked: [],
      error: {
        kind: "invalid-input",
        status: null,
        message: `A sequence is empty, longer than ${String(MAX_SEQUENCE_LENGTH)} characters, or holds a quote, a backslash or a control character.`,
      },
    };
  }
  const checked: WikidataResult[] = [];
  for (const batch of batchesOf([...new Set(request.sequences)])) {
    const sent = await queryBatch(batch, request);
    if (!sent.ok) return { checked, error: sent.error };
    checked.push(...sent.value);
  }
  return { checked, error: null };
};
