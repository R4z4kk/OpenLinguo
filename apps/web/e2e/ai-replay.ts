import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { z } from "zod";

const Exchange = z.object({
  request: z.object({ method: z.string(), path: z.string(), body: z.unknown() }),
  response: z.object({ status: z.number().int(), body: z.unknown() }),
});
export type Exchange = z.output<typeof Exchange>;

const Recording = z.object({ model: z.string().nullable(), exchanges: z.array(Exchange) });
export type Recording = z.output<typeof Recording>;

export const recording = (url: URL): Recording =>
  Recording.parse(JSON.parse(readFileSync(url, "utf8")));

export const recorded = (url: URL): readonly Exchange[] => recording(url).exchanges;

const Completion = z.looseObject({
  choices: z.array(z.looseObject({ message: z.looseObject({ content: z.string() }) })),
});
const Indexed = z.object({
  sentences: z.array(z.looseObject({ index: z.number(), corrected: z.string() })),
});
export type AnswerItem = z.output<typeof Indexed>["sentences"][number];

/** The answer items of a recorded correction. */
export const answerItems = (body: unknown): readonly AnswerItem[] =>
  Indexed.parse(JSON.parse(Completion.parse(body).choices[0]?.message.content ?? "")).sentences;

/** A recorded correction whose answer items are rewritten: reordered, or their indices changed. */
export const rewriteItems = (
  body: unknown,
  rewrite: (items: readonly AnswerItem[]) => readonly AnswerItem[],
): unknown => {
  const completion = Completion.parse(body);
  return {
    ...completion,
    choices: completion.choices.map((choice) => ({
      ...choice,
      message: {
        ...choice.message,
        content: JSON.stringify({
          sentences: rewrite(Indexed.parse(JSON.parse(choice.message.content)).sentences),
        }),
      },
    })),
  };
};

export type Sent = {
  readonly url: string;
  readonly authorization: string | null;
  readonly body: unknown;
};

type Reply = {
  readonly request: { readonly method: string; readonly path: string };
  readonly response: { readonly status: number; readonly body: unknown };
};

/**
 * Answers the endpoint's requests with the exchanges of the same method and path; none: unreachable.
 * `exchanges` may wait, to show a call in progress.
 */
export const replay = async (
  page: Page,
  baseUrl: string,
  exchanges: () => readonly Reply[] | null | Promise<readonly Reply[] | null>,
): Promise<Sent[]> => {
  const sent: Sent[] = [];
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };
  await page.route(`${baseUrl}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body: unknown = request.postDataJSON();
    sent.push({
      url: request.url(),
      authorization: await request.headerValue("authorization"),
      body,
    });
    const path = request.url().slice(baseUrl.length);
    const exchange =
      (await exchanges())?.find(
        (candidate) =>
          candidate.request.method === request.method() && candidate.request.path === path,
      ) ?? null;
    // The page may have aborted the request meanwhile.
    if (exchange === null) return route.abort("connectionrefused").catch(() => null);
    return route
      .fulfill({
        status: exchange.response.status,
        headers: cors,
        contentType: "application/json",
        body: JSON.stringify(exchange.response.body),
      })
      .catch(() => null);
  });
  return sent;
};
