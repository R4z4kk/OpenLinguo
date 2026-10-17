import { expect } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";
import { startReading } from "./cards.ts";

test("answers a tone card from the keyboard, accepting the tone spoken after sandhi", async ({
  page,
}) => {
  const main = page.getByRole("main");
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
  });

  await page.goto("/learn");
  const download = main.getByRole("button", { name: /^Download the audio \(/ }).first();
  await expect(download).toBeVisible({ timeout: 90_000 });
  await download.click();
  await expect(main.getByText(en.audio.installed).first()).toBeVisible();

  await startReading(page, { headword: "你好", readingKey: "ni3 hao3" });
  await page.goto("/review");
  const card = page.locator(":focus");
  await expect(card).toContainText(en.review.tone);
  await expect(card).toContainText("你好");
  await expect(main.getByRole("button", { name: en.review.playAudio })).toBeVisible();
  await expect(main.getByRole("group", { name: /ni$/u })).toBeVisible();
  await expect(main.getByRole("button", { name: en.review.showAnswer })).toHaveCount(0);
  expect(await accessibilityViolations(page)).toEqual([]);

  // The recording says ní hǎo: the spoken tone 2 is as right as the citation tone 3.
  await page.keyboard.press("2");
  await page.keyboard.press("3");
  await expect(main.getByRole("radio", { name: "á 2" }).first()).toBeChecked();
  await expect(main.getByRole("radio", { name: "ǎ 3" }).nth(1)).toBeChecked();
  await expect(main.getByRole("button", { name: en.review.toneCheck })).toBeFocused();
  await page.keyboard.press("Enter");

  const result = main.getByRole("status");
  await expect(result).toContainText("Graded: Good");
  await expect(result).toContainText(en.review.toneSaid);
  await expect(main.getByRole("button", { name: en.review.toneContinue })).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.keyboard.press("Enter");
  await expect(main.getByRole("progressbar", { name: en.review.progress })).toHaveAttribute(
    "value",
    "1",
  );
  await expect(main.getByRole("status")).toHaveCount(0);
});

test("grades a wrong tone again and shows the answer as text", async ({ page }) => {
  const main = page.getByRole("main");
  await page.goto("/learn");
  await expect(main.getByRole("button", { name: /^Download the audio \(/ }).first()).toBeVisible({
    timeout: 90_000,
  });
  await main
    .getByRole("button", { name: /^Download the audio \(/ })
    .first()
    .click();
  await expect(main.getByText(en.audio.installed).first()).toBeVisible();

  await startReading(page, { headword: "谢谢", readingKey: "xie4 xie5" });
  await page.goto("/review");
  await expect(page.locator(":focus")).toContainText(en.review.tone);
  await page.keyboard.press("1");
  await page.keyboard.press("1");
  await page.keyboard.press("Enter");
  const result = main.getByRole("status");
  await expect(result).toContainText("Graded: Again");
  await expect(result).toContainText("Not quite");
  await expect(result).toContainText("à 4");
  expect(await accessibilityViolations(page)).toEqual([]);
});
