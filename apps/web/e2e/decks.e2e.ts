import { expect } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

test("adds a word to my words from the keyboard, counts it in Learn, then removes it", async ({
  page,
}) => {
  const main = page.getByRole("main");
  const myWords = main
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: en.decks.myWords }) });

  await page.goto("/learn/dictionary/你好");
  const add = main.getByRole("button", { name: en.myWords.add });
  await expect(add).toBeEnabled({ timeout: 90_000 });
  await add.focus();
  await page.keyboard.press("Enter");
  const remove = main.getByRole("button", { name: en.myWords.remove });
  await expect(remove).toBeFocused();
  await expect(main.getByRole("status")).toHaveText(en.myWords.added);
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.getByRole("link", { name: en.nav.learn }).click();
  await expect(myWords.getByRole("definition")).toHaveText(["2", "0", "0"]);
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.goBack();
  await expect(remove).toBeEnabled();
  await remove.focus();
  await page.keyboard.press("Enter");
  await expect(add).toBeFocused();
  await expect(main.getByRole("status")).toHaveText("");

  await page.getByRole("link", { name: en.nav.learn }).click();
  await expect(myWords.getByRole("definition")).toHaveText(["0", "0", "0"]);
});
