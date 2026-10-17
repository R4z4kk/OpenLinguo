import { expect, type Locator, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";
import { startReading } from "./cards.ts";

type Point = readonly [number, number];

/** A character's stroke medians from the imported data, in the stroke data's units (y up). */
const mediansOf = (page: Page, character: string): Promise<readonly (readonly Point[])[]> =>
  page.evaluate(
    (character) =>
      new Promise<readonly (readonly Point[])[]>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const request = open.result.transaction("strokes").objectStore("strokes").get(character);
          request.onerror = () => {
            reject(new Error(String(request.error)));
          };
          request.onsuccess = () => {
            open.result.close();
            resolve((request.result as { medians: readonly (readonly Point[])[] }).medians);
          };
        };
      }),
    character,
  );

/** Drags the mouse along the points, given in the stroke data's units, on the drawing grid. */
const drag = async (page: Page, grid: Locator, points: readonly Point[]): Promise<void> => {
  const box = await grid.boundingBox();
  if (box === null) throw new Error("the drawing grid is not shown");
  const onPage = points.map(
    ([x, y]) => [box.x + (x / 1024) * box.width, box.y + ((900 - y) / 1024) * box.height] as const,
  );
  const first = onPage.at(0) ?? null;
  if (first === null) throw new Error("no point to draw");
  await page.mouse.move(first[0], first[1]);
  await page.mouse.down();
  for (const [x, y] of onPage.slice(1)) await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.up();
};

/** Far below every stroke. */
const WRONG: readonly Point[] = [
  [100, -80],
  [900, -80],
];

test("draws a writing card with the mouse: a stroke along its median is accepted, a wrong one rejected", async ({
  page,
}) => {
  const main = page.getByRole("main");
  await page.goto("/learn");
  await page.evaluate(() => {
    localStorage.setItem("openlinguo.practiceWriting", "true");
    localStorage.setItem("openlinguo.practiceTyping", "false");
  });
  await startReading(page, { headword: "人", readingKey: "ren2" });
  const medians = await mediansOf(page, "人");
  const first = medians[0] ?? null;
  const second = medians[1] ?? null;
  if (first === null || second === null) throw new Error("人 has two strokes");

  await page.goto("/review");
  const card = page.locator(":focus");
  await expect(card).toContainText(en.review.writingTitle);
  await expect(card).toContainText("Character 1 of 1");
  await expect(main.getByRole("button", { name: en.review.showAnswer })).toHaveCount(0);
  const grid = main.getByRole("img", { name: "Drawing area, character 1 of 1" }).locator("svg");
  await expect(grid).toHaveCSS("touch-action", "none");
  const status = main.getByRole("status");
  expect(await accessibilityViolations(page)).toEqual([]);

  await drag(page, grid, second);
  await expect(status).toHaveText("Stroke 1: not quite, try again.");
  await drag(page, grid, first);
  await expect(status).toHaveText("Stroke 1: right.");

  for (let miss = 0; miss < 3; miss += 1) await drag(page, grid, WRONG);
  await expect(status).toHaveText("Stroke 2: 3 misses. Its outline is shown, trace it.");
  await expect(main.getByRole("img", { name: /, hint shown$/u })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  await drag(page, grid, second);
  await expect(status).toContainText("Graded: Again");
  await expect(main.getByRole("figure")).toContainText("人: 4 misses, hint at stroke 2");
  await expect(main.getByRole("button", { name: en.review.toneContinue })).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.keyboard.press("Enter");
  await expect(main.getByRole("progressbar", { name: en.review.progress })).toHaveAttribute(
    "value",
    "1",
  );
});
