import { expect, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";
import { startReading } from "./cards.ts";

type DrillWord = {
  readonly headword: string;
  readonly readingKey: string;
  readonly gloss: string;
  readonly pinyin: string;
};

/** Both words come first among the candidates of their toneless pinyin. */
const PHONE: DrillWord = {
  headword: "电话",
  readingKey: "dian4 hua4",
  gloss: "telephone",
  pinyin: "dianhua",
};
const BOOKS: DrillWord = {
  headword: "图书",
  readingKey: "tu2 shu1",
  gloss: "books",
  pinyin: "tushu",
};

/** The review log's size and the cards as stored: a drill changes neither. */
const stored = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ readonly reviews: number; readonly cards: string }>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const transaction = open.result.transaction(["reviews", "cards"]);
          const reviews = transaction.objectStore("reviews").count();
          const cards = transaction.objectStore("cards").getAll();
          transaction.onerror = () => {
            reject(new Error(String(transaction.error)));
          };
          transaction.oncomplete = () => {
            open.result.close();
            resolve({ reviews: reviews.result, cards: JSON.stringify(cards.result) });
          };
        };
      }),
  );

const openDrill = async (page: Page) => {
  await page.goto("/learn");
  await startReading(page, PHONE);
  await startReading(page, BOOKS);
  await page.goto("/learn/typing");
  const main = page.getByRole("main");
  await expect(main).toContainText("Rounds of 10 words drawn from your 2 started words.");
  return { main, before: await stored(page) };
};

/** The word whose meaning the card shows. */
const shownWord = async (page: Page): Promise<DrillWord> =>
  (await page.getByRole("main").getByText(PHONE.gloss).count()) > 0 ? PHONE : BOOKS;

/** Types the word's pinyin and commits its first candidate with Enter. */
const typeAnswer = async (page: Page, word: DrillWord): Promise<void> => {
  const field = page.getByRole("combobox", { name: en.ime.answer });
  await expect(field).toBeFocused();
  await page.keyboard.type(word.pinyin);
  const first = page.getByRole("listbox", { name: en.ime.candidates }).getByRole("option").first();
  await expect(first).toHaveText(word.headword);
  await page.keyboard.press("Enter");
  await expect(field).toHaveValue("");
};

test("plays an untimed round with the keyboard only, then another, writing no review", async ({
  page,
}) => {
  const { main, before } = await openDrill(page);
  const timer = main.getByRole("switch", { name: en.drill.timer });
  const start = main.getByRole("button", { name: en.drill.start });

  await main.getByRole("link", { name: en.nav.learn }).focus();
  await page.keyboard.press("Tab");
  await expect(timer).toBeFocused();
  await expect(timer).toHaveAttribute("aria-checked", "false");
  await expect(main.getByRole("group", { name: en.drill.duration })).toHaveCount(0);
  await page.keyboard.press("Tab");
  await expect(start).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.keyboard.press("Enter");
  await expect(main).toContainText("Word 1 of 2");
  await expect(page.getByRole("timer")).toHaveCount(0);
  const first = await shownWord(page);
  const second = first === PHONE ? BOOKS : PHONE;
  await typeAnswer(page, first);
  await page.keyboard.press("Enter");
  const status = main.getByRole("status");
  await expect(status).toContainText(`Word 1: ${first.headword}`);
  await expect(status).toContainText(en.drill.lastRight);

  await expect(main).toContainText("Word 2 of 2");
  await expect(main.getByText(second.gloss)).toBeVisible();
  await page.keyboard.type(first.pinyin);
  await expect(
    main.getByRole("listbox", { name: en.ime.candidates }).getByRole("option").first(),
  ).toHaveText(first.headword);
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");

  await expect(main.getByRole("heading", { level: 2, name: en.drill.finished })).toBeFocused();
  await expect(main).toContainText(/Finished in \d+ sec/u);
  await expect(main.getByRole("definition").filter({ hasText: "1 of 2" })).toBeVisible();
  await expect(main.getByRole("definition").filter({ hasText: "1 to work on" })).toBeVisible();
  await expect(main.getByText(en.drill.perMinute)).toBeVisible();
  const missed = main.getByRole("listitem").filter({ hasText: second.headword });
  await expect(missed).toContainText(`${en.drill.typed} ${first.headword}`);
  await expect(missed).toContainText(second.gloss);
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.keyboard.press("Tab");
  await expect(main.getByRole("button", { name: en.drill.again })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(main).toContainText("Word 1 of 2");
  await expect(page.getByRole("combobox", { name: en.ime.answer })).toBeFocused();
  expect(await stored(page)).toEqual(before);
});

test("plays a timed round with the keyboard only until its time is up, writing no review", async ({
  page,
}) => {
  await page.clock.install();
  const { main, before } = await openDrill(page);
  const timer = main.getByRole("switch", { name: en.drill.timer });

  await main.getByRole("link", { name: en.nav.learn }).focus();
  await page.keyboard.press("Tab");
  await expect(timer).toBeFocused();
  await page.keyboard.press("Space");
  await expect(timer).toHaveAttribute("aria-checked", "true");
  const duration = main.getByRole("group", { name: en.drill.duration });
  await expect(duration.getByRole("radio", { name: "2 min" })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(duration.getByRole("radio", { name: "2 min" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(duration.getByRole("radio", { name: "1 min" })).toBeChecked();
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Tab");
  await expect(main.getByRole("button", { name: en.drill.start })).toBeFocused();
  await page.keyboard.press("Enter");

  const left = page.getByRole("timer", { name: en.drill.timeLeft });
  await expect(left).toHaveText(/^(1:00|0:5\d)$/u);
  const first = await shownWord(page);
  const second = first === PHONE ? BOOKS : PHONE;
  await typeAnswer(page, first);
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(main.getByRole("status")).toContainText(en.drill.lastRight);

  await page.clock.fastForward("01:00");
  await expect(main.getByRole("heading", { level: 2, name: en.drill.finished })).toBeFocused();
  await expect(main).toContainText("Timer 1 min · finished in 1 min");
  await expect(main.getByRole("definition").filter({ hasText: "1 of 2" })).toBeVisible();
  await expect(main.getByRole("listitem").filter({ hasText: second.headword })).toContainText(
    en.drill.notReached,
  );
  await expect(page.getByRole("timer")).toHaveCount(0);
  expect(await accessibilityViolations(page)).toEqual([]);
  expect(await stored(page)).toEqual(before);
});
