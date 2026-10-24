import { expect, type Locator, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { put } from "./seed.ts";

const TEXT_ID = "00000000-0000-4000-8000-0000000000b1";
export const TITLE = "周末";

/** Opens the library once so the offline data is imported, then stores a pasted text. */
export const seedText = async (page: Page, body: string): Promise<void> => {
  await page.goto("/read");
  await expect(page.getByRole("main").getByText(en.library.emptyTitle)).toBeVisible({
    timeout: 90_000,
  });
  await put(page, "texts", {
    id: TEXT_ID,
    title: TITLE,
    body,
    source: "paste",
    createdAt: Date.UTC(2026, 9, 24, 10),
    provenance: null,
    readingChoices: {},
  });
};

export const press = async (page: Page, target: Locator, key = "Enter"): Promise<void> => {
  await target.focus();
  await page.keyboard.press(key);
};

/** From the library to the unknown-words panel with the keyboard only. */
export const openPanel = async (page: Page): Promise<Locator> => {
  const main = page.getByRole("main");
  await page.goto("/read");
  const text = main.getByRole("link", { name: TITLE });
  await expect(text).toBeVisible({ timeout: 90_000 });
  await press(page, text);
  const link = main.getByRole("link", { name: /^Unknown words in this text/ });
  await expect(link).toHaveText(/· \d+$/u, { timeout: 60_000 });
  await press(page, link);
  await expect(main.getByRole("heading", { level: 1, name: /· \d+$/u })).toBeVisible();
  return main;
};

export const card = (main: Locator, sequence: string): Locator =>
  main
    .getByRole("listitem")
    .filter({ has: main.page().getByRole("heading", { level: 2, name: sequence }) });

/** All the rows of one IndexedDB store of the app. */
export const rowsOf = (page: Page, store: string): Promise<unknown> =>
  page.evaluate(
    (name) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const request = open.result.transaction(name).objectStore(name).getAll();
          request.onsuccess = () => {
            open.result.close();
            resolve(request.result);
          };
        };
      }),
    store,
  );
