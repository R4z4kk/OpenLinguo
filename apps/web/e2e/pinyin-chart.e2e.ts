import { expect } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

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
