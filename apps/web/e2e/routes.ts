import type { Locator, Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { moderationEn } from "../src/i18n/moderation/en.ts";

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
  "/learn/journal": {
    url: "/learn/journal",
    ready: (page) => page.getByText(en.journal.sensitive),
  },
  "/learn/journal/$day": {
    url: "/learn/journal/2026-10-19",
    ready: (page) => page.getByText(en.journal.notFound),
  },
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
  "/read/new": { url: "/read/new", ready: title(en.library.pasteTitle) },
  "/read/story": { url: "/read/story", ready: title(en.story.title) },
  // `vite preview` has no API: both pages show their failure and « Réessayer ».
  "/read/library": {
    url: "/read/library",
    ready: (page) => page.getByRole("button", { name: en.globalLibrary.retry }),
  },
  "/read/library/$id": {
    url: "/read/library/00000000-0000-4000-8000-000000000000",
    ready: (page) => page.getByRole("button", { name: en.globalLibrary.retry }),
  },
  "/read/$id": {
    url: "/read/00000000-0000-4000-8000-000000000000",
    ready: (page) => page.getByText(en.reader.notFound),
  },
  "/read/$id/unknown": {
    url: "/read/00000000-0000-4000-8000-000000000000/unknown",
    ready: (page) => page.getByText(en.reader.notFound),
  },
  "/read/$id/submit": {
    url: "/read/00000000-0000-4000-8000-000000000000/submit",
    ready: (page) => page.getByText(en.submit.textMissing),
  },
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
  // `vite preview` has no API: the page shows its failure and « Réessayer ».
  "/profile/account": {
    url: "/profile/account",
    ready: (page) => page.getByRole("button", { name: en.submit.retry }),
  },
  "/account/sign-in": {
    url: "/account/sign-in",
    ready: (page) => page.getByRole("button", { name: en.submit.retry }),
  },
  "/admin": {
    url: "/admin",
    ready: (page) => page.getByRole("button", { name: moderationEn.retry }),
  },
  "/admin/notices": {
    url: "/admin/notices",
    ready: (page) => page.getByRole("button", { name: moderationEn.retry }),
  },
  "/admin/notices/$id": {
    url: "/admin/notices/00000000-0000-4000-8000-000000000000",
    ready: (page) => page.getByRole("button", { name: moderationEn.retry }),
  },
  "/report": {
    url: "/report?text=00000000-0000-4000-8000-000000000000",
    ready: (page) => page.getByRole("button", { name: en.globalLibrary.retry }),
  },
  "/admin/$id": {
    url: "/admin/00000000-0000-4000-8000-000000000000",
    ready: (page) => page.getByRole("button", { name: moderationEn.retry }),
  },
  "/legal": { url: "/legal?lang=en", ready: title("Legal notice") },
  "/privacy": { url: "/privacy?lang=en", ready: title("Privacy") },
  "/terms": { url: "/terms?lang=en", ready: title("Terms of use") },
};

export const NOT_FOUND_VISIT: Visit = { url: "/missing", ready: title(en.notFound.title) };
