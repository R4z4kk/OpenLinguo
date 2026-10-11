import type { Locator, Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";

export type Visit = {
  readonly url: string;
  /** Visible once the page is fully rendered. */
  readonly ready: (page: Page) => Locator;
};

const title =
  (name: string) =>
  (page: Page): Locator =>
    page.getByRole("heading", { level: 1, name });

/** One visit per router path; `routes.test.ts` keeps the keys in line with the router. */
export const ROUTE_VISITS: Readonly<Record<string, Visit>> = {
  "/": { url: "/", ready: title(en.today.title) },
  "/learn": {
    url: "/learn",
    ready: (page) => page.getByRole("heading", { level: 3, name: en.decks.myWords }),
  },
  "/learn/dictionary": {
    url: "/learn/dictionary?q=hao",
    ready: (page) => page.getByRole("link", { name: "好", exact: true }).first(),
  },
  "/learn/dictionary/$word": {
    url: "/learn/dictionary/行",
    ready: (page) =>
      page.getByRole("img", { name: en.word.strokeImage.replace("{{character}}", "行") }),
  },
  "/read": { url: "/read", ready: title(en.read.title) },
  "/profile": { url: "/profile", ready: title(en.profile.title) },
  "/profile/about": { url: "/profile/about", ready: title(en.about.title) },
};

export const NOT_FOUND_VISIT: Visit = { url: "/missing", ready: title(en.notFound.title) };
