import { expect, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

const LEARNING_TABLES = ["cards", "reviews", "decks", "deckWords"];

const cards = (page: Page): Promise<unknown> =>
  page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const request = open.result.transaction("cards").objectStore("cards").getAll();
          request.onerror = () => {
            reject(new Error(String(request.error)));
          };
          request.onsuccess = () => {
            open.result.close();
            resolve(request.result);
          };
        };
      }),
  );

/** Deletes the learning data and settings, and keeps the dictionary. */
const clear = (page: Page): Promise<void> =>
  page.evaluate(
    (tables) =>
      new Promise<void>((resolve, reject) => {
        localStorage.clear();
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const transaction = open.result.transaction(tables, "readwrite");
          for (const table of tables) transaction.objectStore(table).clear();
          transaction.onerror = () => {
            reject(new Error(String(transaction.error)));
          };
          transaction.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    LEARNING_TABLES,
  );

const imported = (counts: Readonly<Record<string, number>>): string =>
  en.backup.imported.replaceAll(/\{\{(\w+)\}\}/g, (_, name: string) => String(counts[name]));

test("exports, clears and imports back the same cards, counts and settings", async ({
  page,
}, testInfo) => {
  const main = page.getByRole("main");
  // The backup's, above the recordings'.
  const status = main.getByRole("status").first();
  const counts = main.getByRole("definition");
  const dark = main.getByRole("radio", { name: en.theme.dark });
  const noNewCards = main
    .getByRole("group", { name: en.goal.newCardsPerDay })
    .getByRole("radio", { name: "0", exact: true });
  const showProgress = main.getByRole("checkbox", { name: en.progress.show });
  const importButton = main.getByRole("button", { name: en.backup.import });

  await page.goto("/learn/dictionary/你好");
  const myWords = main.getByRole("checkbox", { name: en.decks.myWords });
  await expect(myWords).toBeEnabled({ timeout: 90_000 });
  await myWords.click();
  await expect(myWords).toBeChecked();
  await page.getByRole("link", { name: en.nav.today }).click();
  await main.getByRole("link", { name: en.today.start }).click();
  await expect(page.locator(":focus")).toContainText("你好");
  await page.keyboard.press("Space");
  await expect(page.locator(":focus")).toContainText("hello; hi");
  await page.keyboard.press("4");
  await expect(main.getByRole("progressbar", { name: en.review.progress })).toHaveAttribute(
    "value",
    "1",
  );

  await page.getByRole("link", { name: en.nav.learn }).click();
  await expect(counts.first()).toHaveText("1");
  const before = await counts.allTextContents();
  const stored = await cards(page);

  await page.getByRole("link", { name: en.nav.profile }).click();
  await dark.focus();
  await page.keyboard.press("Space");
  await expect(dark).toBeChecked();
  await noNewCards.focus();
  await page.keyboard.press("Space");
  await expect(noNewCards).toBeChecked();
  await showProgress.uncheck();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    main.getByRole("button", { name: en.backup.export }).click(),
  ]);
  const file = testInfo.outputPath("backup.json");
  await download.saveAs(file);
  await expect(status).toHaveText(en.backup.exported);
  expect(await accessibilityViolations(page)).toEqual([]);

  await clear(page);
  await page.reload();
  await expect(dark).not.toBeChecked();
  await expect(noNewCards).not.toBeChecked();
  await expect(showProgress).toBeChecked();
  await page.getByRole("link", { name: en.nav.learn }).click();
  await expect(counts.first()).toHaveText("0");

  await page.getByRole("link", { name: en.nav.profile }).click();
  // Keyboard: the Profile sections still loading above it would move a pointer click.
  await importButton.focus();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.keyboard.press("Enter"),
  ]);
  await chooser.setFiles(file);
  await expect(status).toHaveText(
    imported({ reviews: 1, cards: 2, decks: 0, words: 1, notes: 0, glosses: 0 }),
  );
  await expect(dark).toBeChecked();
  await expect(noNewCards).toBeChecked();
  await expect(showProgress).not.toBeChecked();
  await expect(main.getByRole("heading", { name: en.progress.title })).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // axe measures colors halfway through the theme transition otherwise.
  await page.waitForFunction(() => document.getAnimations().length === 0);
  expect(await accessibilityViolations(page)).toEqual([]);

  const [again] = await Promise.all([page.waitForEvent("filechooser"), importButton.click()]);
  await again.setFiles(file);
  await expect(status).toHaveText(
    imported({ reviews: 0, cards: 0, decks: 0, words: 0, notes: 0, glosses: 0 }),
  );

  await page.getByRole("link", { name: en.nav.learn }).click();
  await expect(counts.first()).toHaveText("1");
  expect(await counts.allTextContents()).toEqual(before);
  expect(await cards(page)).toEqual(stored);
});

test("lists the failing paths of an invalid backup", async ({ page }) => {
  const main = page.getByRole("main");
  await page.goto("/profile");
  await main.getByRole("button", { name: en.backup.import }).focus();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.keyboard.press("Enter"),
  ]);
  await chooser.setFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "openlinguo-backup", version: 1 })),
  });
  const alert = main.getByRole("alert");
  await expect(alert).toContainText(en.backup.invalid);
  await expect(alert.getByRole("listitem").first()).toContainText("exportedAt");
  expect(await accessibilityViolations(page)).toEqual([]);
});
