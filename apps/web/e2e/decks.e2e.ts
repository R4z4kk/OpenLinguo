import { expect, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

const deck = (page: Page, name: string) =>
  page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

test("files a word in my words from the keyboard, counts it in Learn, then takes it out", async ({
  page,
}) => {
  const myWords = page.getByRole("main").getByRole("checkbox", { name: en.decks.myWords });

  await page.goto("/learn/dictionary/你好");
  await expect(myWords).toBeEnabled({ timeout: 90_000 });
  await myWords.focus();
  await page.keyboard.press("Space");
  await expect(myWords).toBeChecked();
  await expect(myWords).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.getByRole("link", { name: en.nav.learn }).click();
  await expect(deck(page, en.decks.myWords).getByRole("definition")).toHaveText(["2", "0", "0"]);
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.goBack();
  await expect(myWords).toBeChecked();
  await myWords.focus();
  await page.keyboard.press("Space");
  await expect(myWords).not.toBeChecked();

  await page.getByRole("link", { name: en.nav.learn }).click();
  await expect(deck(page, en.decks.myWords).getByRole("definition")).toHaveText(["0", "0", "0"]);
});

test("creates, fills, renames and deletes a deck from the keyboard", async ({ page }) => {
  const main = page.getByRole("main");
  const status = main.getByRole("status");
  const named = (template: string, name: string) => template.replace("{{name}}", name);

  await page.goto("/learn");
  const newDeck = main.getByRole("textbox", { name: en.decks.newDeck });
  await expect(newDeck).toBeVisible({ timeout: 90_000 });
  await newDeck.focus();
  await page.keyboard.type("Animals");
  await page.keyboard.press("Enter");
  await expect(status).toHaveText(named(en.decks.created, "Animals"));
  await expect(newDeck).toHaveValue("");
  await expect(deck(page, "Animals").getByRole("definition")).toHaveText(["0", "0", "0"]);
  await page.keyboard.type("animals");
  await page.keyboard.press("Enter");
  await expect(newDeck).toHaveAccessibleDescription(en.decks.nameProblem.taken);
  expect(await accessibilityViolations(page)).toEqual([]);

  // 企鹅 is in no HSK 2025 band: it leaves the queue with its last deck.
  await page.goto("/learn/dictionary/企鹅");
  const animals = main.getByRole("checkbox", { name: "Animals" });
  await expect(animals).toBeEnabled({ timeout: 90_000 });
  await animals.focus();
  await page.keyboard.press("Space");
  await expect(animals).toBeChecked();
  await expect(main.getByRole("checkbox", { name: en.decks.myWords })).not.toBeChecked();
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.getByRole("link", { name: en.nav.learn }).click();
  await expect(deck(page, "Animals").getByRole("definition")).toHaveText(["2", "0", "0"]);
  await expect(deck(page, en.decks.myWords).getByRole("definition")).toHaveText(["0", "0", "0"]);

  const rename = deck(page, "Animals").getByRole("button", { name: en.decks.rename });
  await rename.focus();
  await page.keyboard.press("Enter");
  const renaming = page.getByRole("dialog", { name: named(en.decks.renameTitle, "Animals") });
  const name = renaming.getByRole("textbox", { name: en.decks.name });
  await expect(name).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);
  await name.fill("Zoo");
  await page.keyboard.press("Enter");
  await expect(renaming).toBeHidden();
  await expect(status).toHaveText(named(en.decks.renamed, "Zoo"));
  await expect(deck(page, "Zoo").getByRole("button", { name: en.decks.rename })).toBeFocused();

  const remove = deck(page, "Zoo").getByRole("button", { name: en.decks.delete });
  await remove.focus();
  await page.keyboard.press("Enter");
  const deleting = page.getByRole("dialog", { name: named(en.decks.deleteTitle, "Zoo") });
  await expect(deleting).toHaveAccessibleDescription(
    en.decks.leaving_one.replace("{{count}}", "1"),
  );
  await expect(deleting.getByRole("button", { name: en.decks.cancel })).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(deleting).toBeHidden();
  await expect(remove).toBeFocused();

  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(deleting.getByRole("button", { name: en.decks.delete })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(deleting).toBeHidden();
  await expect(main.getByRole("heading", { level: 2, name: en.decks.personal })).toBeFocused();
  await expect(status).toHaveText(named(en.decks.deleted, "Zoo"));
  await expect(deck(page, "Zoo")).toHaveCount(0);

  await page.goto("/learn/dictionary/企鹅");
  await expect(main.getByRole("checkbox", { name: en.decks.myWords })).toBeEnabled({
    timeout: 90_000,
  });
  await expect(main.getByRole("checkbox")).toHaveCount(1);
});
