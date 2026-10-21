import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  loadWikidataRecording,
  WIKIDATA_SAMPLES,
  WIKIDATA_SCENARIOS,
  type WikidataScenario,
} from "./testing/wikidata-recordings.ts";
import {
  isWikidataSequence,
  lookupWikidata,
  WIKIDATA_ENDPOINT,
  type WikidataLookup,
} from "./wikidata.ts";

const DAY = 24 * 60 * 60_000;
const Recorded = z.object({ query: z.string() });
const ENTITY = "http://www.wikidata.org/entity/";
const NAME = "王芳";

type Call = { readonly url: URL; readonly init: RequestInit };
type Row = {
  readonly sequence: string;
  readonly id: string;
  readonly classId: string | null;
  readonly coord: boolean;
  readonly fr: string | null;
  readonly en: string | null;
};

const row = (
  sequence: string,
  id: string,
  extra: Partial<Omit<Row, "sequence" | "id">> = {},
): Row => ({ sequence, id, classId: null, coord: false, fr: null, en: null, ...extra });

const literal = (value: string, lang: string) => ({ type: "literal", "xml:lang": lang, value });

const binding = ({ sequence, id, classId, coord, fr, en }: Row) => ({
  s: literal(sequence, "zh"),
  item: { type: "uri", value: `${ENTITY}${id}` },
  ...(classId === null ? {} : { class: { type: "uri", value: `${ENTITY}${classId}` } }),
  ...(coord ? { coord: { type: "literal", value: "Point(110.48 29.12)" } } : {}),
  ...(fr === null ? {} : { fr: literal(fr, "fr") }),
  ...(en === null ? {} : { en: literal(en, "en") }),
});

const answer = (...rows: readonly Row[]) =>
  new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: rows.map(binding) } }), {
    status: 200,
    headers: { "content-type": "application/sparql-results+json" },
  });

const serve = (...replies: readonly (Response | Error)[]) => {
  const calls: Call[] = [];
  let inFlight = 0;
  let widest = 0;
  const fake: typeof fetch = async (input, init) => {
    const reply = replies.at(Math.min(calls.length, replies.length - 1)) ?? new Error("No reply");
    calls.push({ url: new URL(input instanceof Request ? input.url : input), init: init ?? {} });
    inFlight += 1;
    widest = Math.max(widest, inFlight);
    await Promise.resolve();
    inFlight -= 1;
    if (reply instanceof Error) throw reply;
    return reply.clone();
  };
  return { fetch: fake, calls, widest: () => widest };
};

const lookup = (
  sequences: readonly string[],
  fetcher: typeof fetch,
  signal: AbortSignal = new AbortController().signal,
): Promise<WikidataLookup> => lookupWikidata({ sequences, fetch: fetcher, signal });

const queryOf = (call: Call): string => call.url.searchParams.get("query") ?? "";

const names = (count: number, length = 3): readonly string[] =>
  Array.from({ length: count }, (_, index) =>
    Array.from(String(index).padStart(length, "0"), (digit) =>
      String.fromCodePoint(0x4e00 + Number(digit)),
    ).join(""),
  );

afterEach(() => {
  vi.useRealTimers();
});

describe("isWikidataSequence", () => {
  it.each(["周杰伦", "王", "ABC", "a'b", "一".repeat(30)])("accepts %s", (sequence) => {
    expect(isWikidataSequence(sequence)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["a double quote", 'a"b'],
    ["a backslash", "a\\b"],
    ["a line feed", "a\nb"],
    ["a null character", `a${String.fromCodePoint(0)}b`],
    ["a line separator", `a${String.fromCodePoint(0x2028)}b`],
    ["a lone surrogate", `a${String.fromCharCode(0xd800)}b`],
    ["31 characters", "一".repeat(31)],
  ])("rejects %s", (_, sequence) => {
    expect(isWikidataSequence(sequence)).toBe(false);
  });
});

describe("lookupWikidata request", () => {
  it("sends one GET to the endpoint with the sequence in @zh and @zh-hans", async () => {
    const server = serve(answer());
    await lookup([NAME], server.fetch);
    expect(server.calls.map(({ init }) => init.method)).toEqual(["GET"]);
    expect(server.calls.map(({ url }) => url.origin + url.pathname)).toEqual([
      WIKIDATA_ENDPOINT.value,
    ]);
    expect(server.calls.map(queryOf)[0]).toContain(`"${NAME}"@zh "${NAME}"@zh-hans`);
  });

  it("identifies the app, hides the page and sends no cookie", async () => {
    const server = serve(answer());
    await lookup([NAME], server.fetch);
    const init = server.calls[0]?.init;
    expect(init?.headers).toMatchObject({
      Accept: "application/sparql-results+json",
      "Api-User-Agent": "OpenLinguo (https://github.com/R4z4kk/OpenLinguo)",
    });
    expect(init?.referrerPolicy).toBe("no-referrer");
    expect(init?.credentials).toBe("omit");
  });

  it("calls the injected fetch as a plain function, as a browser requires", async () => {
    const receivers: string[] = [];
    const plain = async function (this: unknown): Promise<Response> {
      receivers.push(typeof this);
      await Promise.resolve();
      return answer();
    } as typeof fetch;
    await lookup([NAME], plain);
    expect(receivers).toEqual(["undefined"]);
  });

  it("sends 50 sequences per request, one request after the other", async () => {
    const server = serve(answer());
    const result = await lookup(names(120), server.fetch);
    expect(server.calls).toHaveLength(3);
    expect(server.widest()).toBe(1);
    expect(result.checked).toHaveLength(120);
    expect(result.error).toBeNull();
  });

  it("sends a duplicate sequence once", async () => {
    const server = serve(answer());
    const result = await lookup([NAME, NAME], server.fetch);
    expect(result.checked.map(({ sequence }) => sequence)).toEqual([NAME]);
    expect(server.calls.map(queryOf)[0]).toContain(`{ "${NAME}"@zh "${NAME}"@zh-hans }`);
  });

  it("keeps every request URL under what the service accepts", async () => {
    const server = serve(answer());
    await lookup(names(50, 20), server.fetch);
    expect(server.calls.length).toBeGreaterThan(1);
    for (const { url } of server.calls) expect(url.href.length).toBeLessThanOrEqual(6_000);
  });

  it("fits the longest sequence in one request", async () => {
    const server = serve(answer());
    await lookup(["一".repeat(30)], server.fetch);
    expect(server.calls).toHaveLength(1);
  });

  it("refuses a sequence that cannot be written in the query, before any request", async () => {
    const server = serve(answer());
    const result = await lookup([NAME, 'a"} UNION {'], server.fetch);
    expect(result).toMatchObject({ checked: [], error: { kind: "invalid-input" } });
    expect(server.calls).toHaveLength(0);
  });

  it("sends nothing for no sequence", async () => {
    const server = serve(answer());
    expect(await lookup([], server.fetch)).toEqual({ checked: [], error: null });
    expect(server.calls).toHaveLength(0);
  });
});

describe("lookupWikidata answer", () => {
  const candidates = async (...rows: readonly Row[]) => {
    const result = await lookup([NAME], serve(answer(...rows)).fetch);
    return result.checked[0]?.candidates ?? [];
  };

  it("returns the sequence with no candidate when nothing is found", async () => {
    const result = await lookup(["王小红", NAME], serve(answer(row(NAME, "Q1"))).fetch);
    expect(
      result.checked.map(({ sequence, candidates: found }) => [sequence, found.length]),
    ).toEqual([
      ["王小红", 0],
      [NAME, 1],
    ]);
  });

  it.each([
    ["a human", { classId: "Q5", coord: true }, "person"],
    ["a business with coordinates", { classId: "Q4830453", coord: true }, "organization"],
    ["a university with coordinates", { classId: "Q3918", coord: true }, "organization"],
    ["an item with coordinates", { classId: "Q748149", coord: true }, "place"],
    ["a coordinate alone", { coord: true }, "place"],
    ["a class unknown to the list", { classId: "Q482994" }, "other"],
    ["no class and no coordinates", {}, "other"],
  ] as const)("types %s as %s", async (_, extra, kind) => {
    const [found] = await candidates(row(NAME, "Q7", extra));
    expect(found).toMatchObject({ id: "Q7", kind });
  });

  it("merges the rows of one item: classes, label languages", async () => {
    const found = await candidates(
      row(NAME, "Q7", { classId: "Q482994", en: "album" }),
      row(NAME, "Q7", { classId: "Q5", en: "album" }),
      row(NAME, "Q7", { classId: "Q5", en: "album" }),
    );
    expect(found).toEqual([
      { id: "Q7", kind: "person", descriptionFr: null, descriptionEn: "album" },
    ]);
  });

  it("leaves out disambiguation pages", async () => {
    const found = await candidates(
      row(NAME, "Q1", { classId: "Q4167410", fr: "page d'homonymie" }),
      row(NAME, "Q1", { classId: "Q482994" }),
      row(NAME, "Q2", { classId: "Q5" }),
    );
    expect(found.map(({ id }) => id)).toEqual(["Q2"]);
  });

  it("lists French descriptions first, then English, then none, keeping the answer's order", async () => {
    const found = await candidates(
      row(NAME, "Q1"),
      row(NAME, "Q2", { en: "singer" }),
      row(NAME, "Q3", { fr: "chanteuse", en: "singer" }),
      row(NAME, "Q4", { en: "athlete" }),
      row(NAME, "Q5", { fr: "athlète" }),
      row(NAME, "Q6"),
    );
    expect(found.map(({ id }) => id)).toEqual(["Q3", "Q5", "Q2", "Q4", "Q1", "Q6"]);
  });

  it("keeps each sequence's candidates apart", async () => {
    const result = await lookup(
      [NAME, "张家界"],
      serve(
        answer(row("张家界", "Q197379", { coord: true }), row(NAME, "Q3376697", { classId: "Q5" })),
      ).fetch,
    );
    expect(result.checked.map(({ candidates: found }) => found.map(({ id }) => id))).toEqual([
      ["Q3376697"],
      ["Q197379"],
    ]);
  });
});

describe("recorded answers", () => {
  const replay = (scenario: WikidataScenario) => {
    const recording = loadWikidataRecording(scenario);
    return {
      recording,
      server: serve(
        ...recording.exchanges.map(
          ({ response }) =>
            new Response(JSON.stringify(response.body), { status: response.status }),
        ),
      ),
    };
  };

  it.each(WIKIDATA_SCENARIOS)("%s: the client asks the recorded query", async (scenario) => {
    const { recording, server } = replay(scenario);
    await lookup(WIKIDATA_SAMPLES[scenario], server.fetch);
    expect(server.calls.map(queryOf)).toEqual(
      recording.exchanges.map(({ request }) => Recorded.parse(request.body).query),
    );
  });

  it("found: a person and a place, with their French descriptions", async () => {
    const result = await lookup(WIKIDATA_SAMPLES.found, replay("found").server.fetch);
    expect(result).toEqual({
      checked: [
        {
          sequence: "周杰伦",
          candidates: [
            {
              id: "Q238819",
              kind: "person",
              descriptionFr: "chanteur et acteur taïwanais",
              descriptionEn: expect.any(String) as string,
            },
          ],
        },
        {
          sequence: "张家界",
          candidates: [
            {
              id: "Q197379",
              kind: "place",
              descriptionFr: "ville-préfecture du Hunan, en Chine",
              descriptionEn: "prefecture-level city in Hunan, China",
            },
          ],
        },
      ],
      error: null,
    });
  });

  it("homonyms: 王芳 gives 31 candidates without the disambiguation page, French descriptions first", async () => {
    const result = await lookup(WIKIDATA_SAMPLES.homonyms, replay("homonyms").server.fetch);
    const candidates = result.checked[0]?.candidates ?? [];
    expect(candidates).toHaveLength(31);
    expect(candidates.map(({ id }) => id)).not.toContain("Q15884760");
    expect(new Set(candidates.map(({ id }) => id)).size).toBe(31);
    const ranks = candidates.map(({ descriptionFr, descriptionEn }) =>
      descriptionFr !== null ? 0 : descriptionEn !== null ? 1 : 2,
    );
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks.filter((rank) => rank === 0).length).toBeGreaterThanOrEqual(5);
    expect(candidates.filter(({ kind }) => kind === "person").length).toBeGreaterThan(20);
  });

  it("nothing: 王小红 is checked and has no candidate", async () => {
    const result = await lookup(WIKIDATA_SAMPLES.nothing, replay("nothing").server.fetch);
    expect(result).toEqual({ checked: [{ sequence: "王小红", candidates: [] }], error: null });
  });
});

describe("lookupWikidata errors", () => {
  // The user manual's shape: HTTP 429 with Retry-After. Not recordable on demand.
  it("returns a 429 as rate-limited, keeps the earlier requests and sends no more", async () => {
    const limited = new Response("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": "30" },
    });
    const server = serve(answer(row(names(1)[0] ?? "", "Q1")), limited);
    const result = await lookup(names(120), server.fetch);
    expect(server.calls).toHaveLength(2);
    expect(result.checked).toHaveLength(50);
    expect(result.error).toEqual({ kind: "rate-limited", status: 429, message: null });
  });

  it("returns a network failure as an error, without a retry", async () => {
    const server = serve(new TypeError("Failed to fetch"));
    const result = await lookup([NAME], server.fetch);
    expect(result).toEqual({
      checked: [],
      error: { kind: "network", status: null, message: null },
    });
    expect(server.calls).toHaveLength(1);
  });

  it.each([403, 431, 500, 503])("returns a %i as server with its status", async (status) => {
    const server = serve(new Response("<html>error</html>", { status }));
    const result = await lookup([NAME], server.fetch);
    expect(result.error).toEqual({ kind: "server", status, message: null });
    expect(server.calls).toHaveLength(1);
  });

  it.each([
    ["a body that is not JSON", "<html>Wikimedia Error</html>"],
    ["JSON of another shape", JSON.stringify({ results: [] })],
    ["a row with no item", JSON.stringify({ results: { bindings: [{ s: { value: NAME } }] } })],
    [
      "an item that is not an entity",
      JSON.stringify({
        results: { bindings: [{ s: { value: NAME }, item: { value: "http://example.org/x" } }] },
      }),
    ],
  ])("returns %s as invalid-response", async (_, body) => {
    const result = await lookup([NAME], serve(new Response(body, { status: 200 })).fetch);
    expect(result.checked).toEqual([]);
    expect(result.error).toMatchObject({ kind: "invalid-response", status: 200 });
  });

  it("returns the caller's abort as aborted", async () => {
    const stop = new AbortController();
    stop.abort();
    const refuse: typeof fetch = (_, init) =>
      init?.signal?.aborted === true
        ? Promise.reject(new DOMException("aborted", "AbortError"))
        : Promise.resolve(answer());
    const result = await lookup([NAME], refuse, stop.signal);
    expect(result.error).toEqual({ kind: "aborted", status: null, message: null });
  });

  it("gives up on a request after 60 seconds", async () => {
    vi.useFakeTimers();
    const hang: typeof fetch = (_, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const pending = lookup([NAME], hang);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await pending).error).toEqual({ kind: "timeout", status: null, message: null });
  });
});

describe("WIKIDATA_ENDPOINT", () => {
  it("was read on Wikimedia's pages in the last six months: read them again, update docs/compliance/wikidata.md, then move checkedOn and reviewBy", () => {
    expect(Date.now()).toBeLessThan(Date.parse(WIKIDATA_ENDPOINT.reviewBy));
    expect(
      Date.parse(WIKIDATA_ENDPOINT.reviewBy) - Date.parse(WIKIDATA_ENDPOINT.checkedOn),
    ).toBeLessThanOrEqual(184 * DAY);
  });

  it("is reviewed before the old service may degrade in February 2027", () => {
    expect(WIKIDATA_ENDPOINT.reviewBy).toBe("2027-01-15");
    expect(new URL(WIKIDATA_ENDPOINT.value).origin).toBe("https://query.wikidata.org");
  });
});
