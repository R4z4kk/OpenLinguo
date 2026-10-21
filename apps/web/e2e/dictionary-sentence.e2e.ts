import { expect } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

test("splits a sentence with no entry into its words", async ({ page }) => {
  await page.goto("/learn/dictionary");
  const search = page.getByRole("searchbox", { name: en.dictionary.label });
  await expect(search).toBeVisible({ timeout: 90_000 });

  await search.fill("明天我们去长城看看吧！");
  const words = page.getByRole("region", { name: en.dictionary.sentence.title });
  await expect(words).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("6 dictionary words");
  await expect(words.getByRole("listitem")).toHaveCount(6);
  for (const word of ["明天", "我们", "去", "长城", "看看", "吧"]) {
    await expect(words.getByRole("link", { name: word, exact: true })).toBeVisible();
  }
  expect(await accessibilityViolations(page)).toEqual([]);

  const otherReadings = words.getByRole("link", { name: "2 other readings of 吧" });
  await otherReadings.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("吧");
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("marks what the dictionary does not know, and gives no gloss", async ({ page }) => {
  await page.goto("/learn/dictionary");
  const search = page.getByRole("searchbox", { name: en.dictionary.label });
  await expect(search).toBeVisible({ timeout: 90_000 });

  await search.fill("我在OpenLinguo学中文。");
  const unknown = page
    .getByRole("listitem")
    .filter({ hasText: "OpenLinguo" })
    .filter({ hasText: en.dictionary.sentence.unknown });
  await expect(unknown).toBeVisible();
  await expect(unknown).toContainText(en.dictionary.sentence.unknownNote);
  await expect(unknown.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("4 dictionary words, 1 unknown chunk");
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("lists the words above the entries that start with the query", async ({ page }) => {
  await page.goto("/learn/dictionary");
  const search = page.getByRole("searchbox", { name: en.dictionary.label });
  await expect(search).toBeVisible({ timeout: 90_000 });

  await search.fill("打电");
  const words = page.getByRole("heading", { level: 2, name: en.dictionary.sentence.title });
  const matches = page.getByRole("heading", {
    level: 2,
    name: en.dictionary.sentence.startingWith,
  });
  await expect(words).toBeVisible();
  await expect(matches).toBeVisible();
  await expect(page.getByRole("link", { name: "打电话", exact: true })).toBeVisible();
  const [wordsBox, matchesBox] = [await words.boundingBox(), await matches.boundingBox()];
  expect(wordsBox?.y).toBeLessThan(matchesBox?.y ?? 0);
  expect(await accessibilityViolations(page)).toEqual([]);

  await search.fill("你好");
  await expect(page.getByRole("link", { name: "你好", exact: true })).toBeVisible();
  await expect(words).toHaveCount(0);
  await expect(matches).toHaveCount(0);
});
