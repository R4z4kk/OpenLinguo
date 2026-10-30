import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { z } from "zod";

const RESPONSES = "../../../packages/core/src/testing/wikidata-responses/";

const Answer = z.looseObject({
  results: z.looseObject({
    bindings: z.array(
      z.looseObject({
        s: z.looseObject({ value: z.string() }),
        item: z.looseObject({ value: z.string() }),
        class: z.looseObject({ value: z.string() }).optional(),
      }),
    ),
  }),
});
export type Answer = z.output<typeof Answer>;
export type Binding = Answer["results"]["bindings"][number];

const Recording = z.object({
  exchanges: z.array(z.object({ response: z.object({ body: Answer }) })).min(1),
});

const DISAMBIGUATION_PAGE = "Q4167410";

/** The recorded answer of `found`, `homonyms` or `nothing`: Wikidata's real rows. */
export const recorded = (scenario: "found" | "homonyms" | "nothing"): Answer => {
  const { exchanges } = Recording.parse(
    JSON.parse(readFileSync(new URL(`${RESPONSES}${scenario}.json`, import.meta.url), "utf8")),
  );
  const first = exchanges.at(0);
  if (first == null) throw new Error(`empty recording ${scenario}`);
  return first.response.body;
};

/** The rows of `from` read as `to`, for a sequence the dictionary has and the sample text cannot. */
export const labelled = (answer: Answer, from: string, to: string): readonly Binding[] =>
  answer.results.bindings
    .filter(({ s }) => s.value === from)
    .map((row) => ({ ...row, s: { ...row.s, value: to } }));

/** The answer of one query that asks for all the sequences. */
export const merged = (...parts: readonly (readonly Binding[])[]): Answer => ({
  head: { vars: ["s", "item", "class", "coord", "fr", "en"] },
  results: { bindings: parts.flat() },
});

/** What the page shows for a sequence: its items, without the disambiguation pages. */
export const itemsOf = (rows: readonly Binding[]): number => {
  const pages = new Set(
    rows
      .filter(({ class: type }) => type?.value.endsWith(DISAMBIGUATION_PAGE))
      .map(({ item }) => item.value),
  );
  return new Set(rows.map(({ item }) => item.value).filter((id) => !pages.has(id))).size;
};

export type Reply =
  | { readonly kind: "answer"; readonly body: unknown }
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "unreachable" };

export type Sent = {
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
};

/** Answers the service's requests (and its CORS preflights) with the next reply; returns what was sent. */
export const replayWikidata = async (
  page: Page,
  replies: () => Reply | Promise<Reply>,
): Promise<Sent[]> => {
  const sent: Sent[] = [];
  const cors = { "Access-Control-Allow-Origin": "*" };
  await page.route("https://query.wikidata.org/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Headers":
            (await request.headerValue("access-control-request-headers")) ?? "",
        },
      });
    }
    sent.push({ url: new URL(request.url()), headers: await request.allHeaders() });
    const reply = await replies();
    if (reply.kind === "unreachable") return route.abort("connectionrefused");
    if (reply.kind === "status") {
      return route.fulfill({ status: reply.status, headers: { ...cors, "Retry-After": "120" } });
    }
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/sparql-results+json",
      body: JSON.stringify(reply.body),
    });
  });
  return sent;
};
