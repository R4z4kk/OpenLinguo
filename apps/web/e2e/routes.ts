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
  "/": {
    url: "/",
    ready: (page) =>
      page.getByText(en.progress.xpCount.replace("{{xp, number}}", "0"), { exact: true }),
  },
  "/review": {
    url: "/review",
    ready: (page) => page.getByRole("button", { name: en.review.showAnswer }),
  },
  "/learn": {
    url: "/learn",
    ready: (page) => page.getByRole("heading", { level: 3, name: en.decks.myWords }),
  },
  "/learn/import": { url: "/learn/import", ready: title(en.ankiImport.title) },
  "/learn/pinyin": { url: "/learn/pinyin", ready: title(en.pinyinChart.title) },
  "/learn/typing": { url: "/learn/typing", ready: (page) => page.getByText(en.drill.empty) },
  "/learn/challenges": {
    url: "/learn/challenges",
    ready: (page) => page.getByText(en.challenge.empty),
  },
  "/learn/challenges/$day": {
    url: "/learn/challenges/2026-10-19",
    ready: (page) => page.getByText(en.challenge.notFound),
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
  "/profile": {
    url: "/profile",
    ready: (page) =>
      page
        .getByRole("main")
        .filter({
          has: page.getByText(en.progress.level.replace("{{level, number}}", "1"), { exact: true }),
        })
        .filter({ has: page.getByText(en.stats.showNumbers) }),
  },
  "/profile/about": { url: "/profile/about", ready: title(en.about.title) },
};

export const NOT_FOUND_VISIT: Visit = { url: "/missing", ready: title(en.notFound.title) };
