import { expect, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

const band = (page: Page, name: string) =>
  page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

test("downloads a band's audio, then plays a word offline with its label", async ({
  page,
  server,
}) => {
  // Records what would play: the test checks the wiring, not the machine's audio output.
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
      document.documentElement.dataset["played"] = this.src;
      return Promise.resolve();
    };
  });
  await page.goto("/learn");
  const hsk1 = band(page, "HSK 1");
  const download = hsk1.getByRole("button", { name: /^Download the audio \(/ });
  await expect(download).toBeVisible({ timeout: 90_000 });
  await expect(download).toHaveAccessibleDescription("HSK 1");
  await download.click();
  await expect(hsk1.getByText(en.audio.installed)).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

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
  await page.goto("/learn/dictionary/谢谢");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: en.review.playAudio }).click();
  await expect(main.getByText(en.audio.synthetic)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset["played"] ?? ""))
    .toMatch(/^blob:/u);
  await expect(main.getByRole("alert")).toHaveCount(0);
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("deletes a band's audio and offers it again", async ({ page }) => {
  await page.goto("/learn");
  const hsk1 = band(page, "HSK 1");
  const download = hsk1.getByRole("button", { name: /^Download the audio \(/ });
  await expect(download).toBeVisible({ timeout: 90_000 });
  await download.click();
  await hsk1.getByRole("button", { name: en.audio.delete }).click();
  await expect(download).toBeVisible();
  await page.goto("/learn/dictionary/谢谢");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("button", { name: en.review.playAudio }),
  ).toHaveCount(0);
});
