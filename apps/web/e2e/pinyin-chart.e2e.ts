import { expect } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";
import { countPlayback } from "./playback.ts";

test("reads a syllable from its final and initial, on a phone, by keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/learn");
  await page.getByRole("link", { name: new RegExp(`^${en.learn.pinyinChart}`) }).click({
    timeout: 90_000,
  });
  await expect(page.getByRole("heading", { level: 1, name: en.pinyinChart.title })).toBeVisible();

  const grid = page.getByRole("region", { name: en.pinyinChart.syllables });
  const initials = (await grid.getByRole("columnheader").allInnerTexts()).map(
    (text) => text.split("\n")[0],
  );
  const cellAt = (finalName: RegExp, initial: string) =>
    grid
      .getByRole("row")
      .filter({ has: page.getByRole("rowheader", { name: finalName }) })
      .getByRole("cell")
      .nth(initials.indexOf(initial) - 1);
  await expect(cellAt(/^ü \[/u, "j")).toHaveText("ju");
  await expect(cellAt(/^ü \[/u, "n")).toHaveText("nü");
  await expect(cellAt(/^iou \[/u, "l")).toHaveText("liu");
  await expect(cellAt(/^-i \[/u, "zh")).toHaveText("zhi");
  await expect(cellAt(/^ü \[/u, "b")).toHaveText("");

  await grid.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => grid.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await grid.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const gridBox = await grid.boundingBox();
  const headerBox = await grid.getByRole("rowheader", { name: /^a \[/u }).boundingBox();
  if (gridBox === null || headerBox === null) throw new Error("the grid is not laid out");
  expect(headerBox.x).toBeLessThanOrEqual(gridBox.x + 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("plays the chart's syllables in a chosen tone, and each initial said alone", async ({
  page,
  browserName,
}) => {
  test.skip(
    process.platform === "win32" && browserName === "webkit",
    "WebKit for Windows has no Web Audio; CI runs this on Linux",
  );
  await countPlayback(page);
  await page.goto("/learn");
  await page.getByRole("link", { name: new RegExp(`^${en.learn.pinyinChart}`) }).click({
    timeout: 90_000,
  });
  const sound = page.getByRole("region", { name: en.pinyinChart.sound });
  await expect(sound).toContainText(en.audio.synthetic);
  const grid = page.getByRole("region", { name: en.pinyinChart.syllables });
  await expect(grid.getByRole("button")).toHaveCount(0);
  await sound.getByRole("button", { name: /^Download the audio \(/u }).click();
  await expect(sound.getByText(en.audio.installed)).toBeVisible({ timeout: 30_000 });

  const root = page.locator("html");
  const syllable = (name: string) => grid.getByRole("button", { name, exact: true });
  /** The radios are visually hidden: chosen by keyboard, as a user would. */
  const chooseTone = async (name: string): Promise<void> => {
    await page.getByRole("radio", { name }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("radio", { name })).toBeChecked();
  };
  await expect(page.getByRole("radio", { name: "ā 1" })).toBeChecked();
  await syllable("ba").click();
  await expect(page.getByText("Playing bā", { exact: true })).toBeVisible();
  await expect(root).toHaveAttribute("data-played", "1");

  await chooseTone("à 4");
  await syllable("lü").click();
  await expect(page.getByText("Playing lǜ", { exact: true })).toBeVisible();

  await chooseTone(en.pinyinChart.toneAll);
  await syllable("ma").click();
  await expect(page.getByText("Playing mā, má, mǎ, mà", { exact: true })).toBeVisible();
  await expect(root).toHaveAttribute("data-played", "6");

  // Every character read ei has other readings: no recording of it in any tone, so no tone transfer either.
  await chooseTone("ā 1");
  await syllable("ei").click();
  await expect(page.getByText("No recording of ēi.", { exact: true })).toBeVisible();
  await expect(root).toHaveAttribute("data-played", "6");

  const initials = page.getByRole("table").first();
  await initials.getByRole("button", { name: "bō", exact: true }).click();
  await expect(page.getByText("Playing bō", { exact: true })).toBeVisible();
  await expect(initials.getByRole("button", { name: "tè", exact: true })).toBeVisible();
  await expect(
    initials
      .getByRole("row")
      .filter({ has: page.getByRole("rowheader", { name: "f" }) })
      .getByRole("button"),
  ).toHaveCount(0);
  expect(await accessibilityViolations(page)).toEqual([]);

  await sound.getByRole("button", { name: en.audio.delete }).click();
  await expect(grid.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "ā 1" })).toHaveCount(0);
});
