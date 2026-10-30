import { expect, type Locator, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";
import { startCards } from "./cards.ts";
import { put } from "./seed.ts";

const TEXT_ID = "00000000-0000-4000-8000-0000000000b1";
/** Words: 我们 和 他 去 学校 你好 他 说 你好; known: 我们; 和 has several readings. */
const BODY = "我们和他去学校。你好！\n\n他说：“你好。”";
const MARKED_WORD = { headword: "我们", readingKey: "wo3 men5", markedAt: 1 };

const coverage = (percent: number): string =>
  en.wordSheet.coverage.replace("{{percent}}", `${String(percent)}%`);

const seed = async (page: Page): Promise<void> => {
  await page.goto("/read");
  await expect(page.getByRole("main").getByText(en.library.emptyTitle)).toBeVisible({
    timeout: 90_000,
  });
  await put(page, "texts", {
    id: TEXT_ID,
    title: "周末",
    body: BODY,
    source: "paste",
    createdAt: Date.UTC(2026, 9, 24, 10),
    provenance: null,
    readingChoices: {},
  });
  await put(page, "knownMarks", MARKED_WORD);
};

/** From the library to the passage with the keyboard only. */
const openReader = async (page: Page): Promise<Locator> => {
  const main = page.getByRole("main");
  await page.goto("/read");
  const link = main.getByRole("link", { name: "周末" });
  await expect(link).toBeVisible({ timeout: 90_000 });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(main.locator("p[lang='zh-Hans']").first()).toBeVisible({ timeout: 60_000 });
  return main;
};

const rowsOf = (page: Page, store: string): Promise<number> =>
  page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const request = open.result.transaction(name).objectStore(name).count();
          request.onerror = () => {
            reject(new Error(String(request.error)));
          };
          request.onsuccess = () => {
            open.result.close();
            resolve(request.result);
          };
        };
      }),
    store,
  );

test("chooses a reading, marks the word known and files it, with the keyboard only", async ({
  page,
}) => {
  await seed(page);
  const main = await openReader(page);
  const words = main.locator("p[lang='zh-Hans'] button");
  const sheet = page.getByRole("dialog");
  const status = sheet.getByRole("status");
  const radios = sheet.getByRole("radio");
  const add = sheet.getByRole("button", { name: en.wordSheet.add, exact: true });
  const known = sheet.getByRole("button", { name: en.wordSheet.known, exact: true });
  const forgotten = sheet.getByRole("button", { name: en.wordSheet.forgotten, exact: true });

  // Enter on a polyphone: the heading has focus and no reading is chosen for the learner.
  await words.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { level: 2, name: "和" })).toBeFocused();
  await expect(words.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(sheet).toHaveAccessibleDescription(en.wordSheet.chooseReading);
  expect(await radios.count()).toBeGreaterThan(1);
  await expect(sheet.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(add).toHaveAttribute("aria-disabled", "true");
  await expect(known).toHaveAccessibleDescription(en.wordSheet.chooseFirst);
  await expect(status).toHaveText("");
  expect(await accessibilityViolations(page)).toEqual([]);

  // The actions wait for a choice.
  await known.focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("");

  // Heading, close, the readings, then the actions.
  await sheet.getByRole("heading", { level: 2 }).focus();
  await page.keyboard.press("Tab");
  await expect(sheet.getByRole("button", { name: en.wordSheet.close })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(radios.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(radios.nth(1)).toBeChecked();
  await expect(sheet.getByRole("radio", { checked: true })).toHaveCount(1);
  await expect(status).toHaveText(`${en.wordSheet.done.choice} ${coverage(11)}`);
  await expect(sheet).not.toHaveAccessibleDescription(en.wordSheet.chooseReading);
  await expect(add).not.toHaveAttribute("aria-disabled", "true");
  expect(await accessibilityViolations(page)).toEqual([]);

  // « I know this word » keeps focus on the button, which becomes the opposite action.
  await page.keyboard.press("Tab");
  await expect(sheet.getByRole("combobox", { name: en.wordSheet.deck })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(add).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText(
    `${en.wordSheet.done.filed.replace("{{deck}}", en.decks.myWords)} ${coverage(11)}`,
  );
  await expect.poll(() => rowsOf(page, "deckWords")).toBe(1);
  await page.keyboard.press("Tab");
  await expect(known).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText(`${en.wordSheet.done.known} ${coverage(22)}`);
  await expect(forgotten).toBeFocused();
  await expect(known).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(sheet.getByRole("link", { name: en.wordSheet.wordPage })).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);

  // Escape gives the word its focus back; the choice and the mark are stored.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(words.nth(1)).toBeFocused();
  await expect(main.locator("p button[aria-current]")).toHaveCount(0);
  await expect(main.getByText("22%", { exact: true })).toBeVisible();
  await page.reload();
  await expect(words.nth(1)).toBeVisible({ timeout: 60_000 });
  await expect(main.getByText("22%", { exact: true })).toBeVisible();
  await words.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(sheet.getByRole("radio", { checked: true })).toHaveCount(1);
  await expect(forgotten).toBeVisible();
  await expect(sheet.getByRole("radio").nth(1)).toBeChecked();
});

test("keeps the word above the sheet on a phone and closes it from the close button", async ({
  page,
}) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 600 });
  const main = await openReader(page);
  const last = main.locator("p[lang='zh-Hans'] button").last();
  const sheet = page.getByRole("dialog");

  await last.focus();
  await page.keyboard.press("Enter");
  await expect(sheet).toBeVisible();
  await expect
    .poll(async () => {
      const word = await last.boundingBox();
      const shown = await sheet.boundingBox();
      if (word === null || shown === null) return null;
      return {
        above: word.y + word.height <= shown.y + 1,
        onScreen: word.y >= 0,
        bottom: Math.round(shown.y + shown.height),
        half: shown.height <= 300 + 1,
      };
    })
    .toEqual({ above: true, onScreen: true, bottom: 600, half: true });
  // The page had to scroll for it.
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(await accessibilityViolations(page)).toEqual([]);

  await sheet.getByRole("button", { name: en.wordSheet.close }).click();
  await expect(sheet).toBeHidden();
  await expect(last).toBeFocused();
});

test("works offline: pinyin, glosses, the known mark and the word page", async ({
  page,
  server,
}) => {
  await seed(page);
  await openReader(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? null,
        ),
      { message: "service worker activated", timeout: 30_000 },
    )
    .toBe("activated");
  await server.goOffline();
  await page.reload();
  const main = await openReader(page);
  const sheet = page.getByRole("dialog");
  const status = sheet.getByRole("status");

  await main.locator("p[lang='zh-Hans'] button").nth(4).focus();
  await page.keyboard.press("Enter");
  await expect(sheet.getByRole("heading", { level: 2, name: "学校" })).toBeFocused();
  await expect(sheet).toHaveAccessibleDescription(/xué xiào/);
  await expect(sheet).toContainText("school");
  await expect(sheet.getByRole("radio")).toHaveCount(0);
  expect(await accessibilityViolations(page)).toEqual([]);

  const known = sheet.getByRole("button", { name: en.wordSheet.known, exact: true });
  await known.focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText(`${en.wordSheet.done.known} ${coverage(22)}`);
  const forgotten = sheet.getByRole("button", { name: en.wordSheet.forgotten, exact: true });
  await expect(forgotten).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText(`${en.wordSheet.done.forgotten} ${coverage(11)}`);
  await expect(known).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);

  await sheet.getByRole("link", { name: en.wordSheet.wordPage }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/%E5%AD%A6%E6%A0%A1$/u);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("xué");
  await expect(sheet).toBeHidden();
});

test("says that a card is in its learning steps instead of offering to add the word", async ({
  page,
}) => {
  await seed(page);
  await startCards(
    page,
    { headword: "学校", readingKey: "xue2 xiao4" },
    ["recognition"],
    "learning",
  );
  const main = await openReader(page);
  const sheet = page.getByRole("dialog");

  await main.locator("p[lang='zh-Hans'] button").nth(4).focus();
  await page.keyboard.press("Enter");
  await expect(sheet.getByText(en.wordSheet.learning)).toBeVisible();
  await expect(sheet.getByRole("button", { name: en.wordSheet.add })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: en.wordSheet.known, exact: true })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
});
