import { expect } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";
import { startCards } from "./cards.ts";

/** With their tone cards started too, the audio downloaded leaves the typing card next. */
const STARTED = ["recognition", "recall", "tone"];

test("answers a typing card right and one wrong through the in-app IME, keyboard only", async ({
  page,
}) => {
  const main = page.getByRole("main");
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function play() {
      document.documentElement.dataset["played"] = "true";
      return Promise.resolve();
    };
  });

  await page.goto("/learn");
  const download = main.getByRole("button", { name: /^Download the audio \(/u }).first();
  await expect(download).toBeVisible({ timeout: 90_000 });
  await download.click();
  await expect(main.getByText(en.audio.installed).first()).toBeVisible();
  // 你好 sorts before 电话: it comes first.
  await startCards(page, { headword: "你好", readingKey: "ni3 hao3" }, STARTED);
  await startCards(page, { headword: "电话", readingKey: "dian4 hua4" }, STARTED);

  await page.goto("/review");
  const card = page.locator(":focus");
  const listen = main.getByRole("button", { name: en.review.playAudio });
  const field = main.getByRole("combobox", { name: en.ime.answer });
  const options = main.getByRole("listbox", { name: en.ime.candidates }).getByRole("option");
  const result = main.getByRole("status");
  const progress = main.getByRole("progressbar", { name: en.review.progress });

  // Meaning and audio, neither characters nor pinyin; the session's Space and 1–4 are off.
  await expect(card).toContainText(en.review.typingTitle);
  await expect(card).toContainText(en.review.typing);
  await expect(card).not.toContainText("你好");
  await expect(card).not.toContainText("nǐ");
  await expect(listen).toBeVisible();
  await expect(main.getByText(en.review.typingKeys)).toBeVisible();
  await page.keyboard.press("Space");
  await page.keyboard.press("3");
  await expect(main.getByRole("button", { name: en.review.showAnswer })).toHaveCount(0);
  await expect(main.getByRole("button", { name: en.review.grades.good })).toHaveCount(0);
  await expect(result).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-played", "true");
  expect(await accessibilityViolations(page)).toEqual([]);

  // Right: pinyin, the first candidate committed with Space, Enter on the empty buffer checks.
  await page.keyboard.press("Tab");
  await expect(listen).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(field).toBeFocused();
  await page.keyboard.type("nihao");
  await expect(options.first()).toHaveText("你好");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await expect(field).toHaveAttribute("aria-expanded", "true");
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Space");
  await expect(field).toHaveValue("");
  await expect(field).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");

  await expect(result).toContainText("Graded: Good");
  await expect(result).toContainText(`${en.review.typingYours} 你好 nǐ hǎo`);
  await expect(main).toContainText(en.review.typingAnswer);
  await expect(main.getByRole("button", { name: en.review.toneContinue })).toBeFocused();
  await expect(main.getByText(en.review.continueKeys)).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  // Good leaves the new card learning: it comes back, its word not done yet.
  await page.keyboard.press("Enter");
  await expect(progress).toHaveAttribute("value", "0");

  // Wrong: arrows to a homophone, Enter commits it, Enter again checks.
  await expect(card).toContainText(en.review.typing);
  await expect(card).not.toContainText("电话");
  await page.keyboard.press("Tab");
  await expect(listen).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(field).toBeFocused();
  await page.keyboard.type("dianhua");
  await expect(options.first()).toHaveText("电话");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(options.nth(2)).toHaveText("点画");
  await expect(options.nth(2)).toHaveAttribute("aria-selected", "true");
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(field).toHaveValue("");
  await page.keyboard.press("Enter");

  await expect(result).toContainText("Graded: Again");
  await expect(result).toContainText(`${en.review.typingYours} 点画 diǎn huà`);
  await expect(main.locator("ruby")).toContainText("电");
  await expect(main.locator("ruby")).toContainText("diàn");
  await expect(main.getByRole("button", { name: en.review.toneContinue })).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(result).toHaveCount(0);
  await expect(progress).toHaveAttribute("value", "0");
  await expect(page.locator("html")).not.toHaveAttribute("data-played", "true");
});
