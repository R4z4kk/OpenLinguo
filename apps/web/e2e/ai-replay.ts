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

export type Sent = {
  readonly url: string;
  readonly authorization: string | null;
  readonly body: unknown;
};

type Reply = {
  readonly request: { readonly method: string; readonly path: string };
  readonly response: { readonly status: number; readonly body: unknown };
};

/** Answers the endpoint's requests with the exchanges of the same method and path; none: unreachable. */
export const replay = async (
  page: Page,
  baseUrl: string,
  exchanges: () => readonly Reply[] | null,
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
      exchanges()?.find(
        (candidate) =>
          candidate.request.method === request.method() && candidate.request.path === path,
      ) ?? null;
    if (exchange === null) return route.abort("connectionrefused");
    return route.fulfill({
      status: exchange.response.status,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify(exchange.response.body),
    });
  });
  return sent;
};
