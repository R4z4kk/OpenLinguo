import { expect } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

test("reviews my word first from the keyboard, then a band word", async ({ page }) => {
  const main = page.getByRole("main");
  const focused = page.locator(":focus");
  const progress = main.getByRole("progressbar", { name: en.review.progress });

  await page.goto("/learn/dictionary/你好");
  const myWords = main.getByRole("checkbox", { name: en.decks.myWords });
  await expect(myWords).toBeEnabled({ timeout: 90_000 });
  await myWords.click();
  await expect(myWords).toBeChecked();

  await page.getByRole("link", { name: en.nav.today }).click();
  await main.getByRole("link", { name: en.today.start }).click();
  await expect(focused).toContainText(en.review.recognition);
  await expect(focused).toContainText("你好");
  await expect(progress).toHaveAttribute("value", "0");
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.keyboard.press("Space");
  await expect(focused).toContainText("nǐ");
  await expect(focused).toContainText("hello; hi");
  await expect(main.getByRole("button", { name: `${en.review.grades.good} 10 min` })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.keyboard.press("3");
  await expect(progress).toHaveAttribute("value", "1");
  await expect(focused).toContainText(en.review.recognition);
  await expect(focused).not.toContainText("你好");
  expect(await accessibilityViolations(page)).toEqual([]);
});
