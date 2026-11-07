import { expect, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import {
  accessibilityViolations,
  chineseOutsideZh,
  focusProblems,
  horizontalOverflow,
  runningAnimations,
} from "./accessibility.ts";
import { test } from "./app.ts";
import { NOT_FOUND_VISIT, ROUTE_VISITS } from "./routes.ts";

const VISITS = [...Object.values(ROUTE_VISITS), NOT_FOUND_VISIT];
const SCHEMES = ["light", "dark"] as const;

const importDictionary = async (page: Page): Promise<void> => {
  await page.goto("/learn/dictionary");
  await expect(page.getByRole("searchbox", { name: en.dictionary.label })).toBeVisible({
    timeout: 90_000,
  });
};

test("every route passes axe in light and dark", async ({ page }) => {
  // The dictionary import, then about 4 s per visit on CI's WebKit: grows with the routes.
  test.setTimeout(90_000 + VISITS.length * SCHEMES.length * 4_000);
  await importDictionary(page);
  for (const colorScheme of SCHEMES) {
    await page.emulateMedia({ colorScheme });
    for (const { url, ready } of VISITS) {
      await test.step(`${colorScheme} ${url}`, async () => {
        await page.goto(url);
        await expect(ready(page)).toBeVisible();
        expect(await accessibilityViolations(page)).toEqual([]);
      });
    }
  }
});

test("every route keeps Chinese in a zh language, fits 320 px and stops animating when asked", async ({
  page,
}) => {
  test.setTimeout(90_000 + VISITS.length * 4_000);
  await importDictionary(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const problems: string[] = [];
  for (const { url, ready } of VISITS) {
    await page.goto(url);
    await expect(ready(page)).toBeVisible();
    const overflow = await horizontalOverflow(page);
    if (overflow > 0) problems.push(`${url}: scrolls ${String(overflow)} px sideways at 320 px`);
    for (const found of await chineseOutsideZh(page)) problems.push(`${url}: ${found}`);
    for (const animation of await runningAnimations(page)) {
      problems.push(`${url}: ${animation} runs under reduced motion`);
    }
  }
  expect(problems).toEqual([]);
});

test("Tab never traps and every stop shows focus", async ({ page, browserName }) => {
  // WebKit does not tab to links unless the system asks for it: the order is checked in Chromium.
  test.skip(browserName !== "chromium", "WebKit skips links when tabbing");
  test.setTimeout(90_000 + VISITS.length * 8_000);
  await importDictionary(page);
  const problems: string[] = [];
  for (const { url, ready } of VISITS) {
    await page.goto(url);
    await expect(ready(page)).toBeVisible();
    for (const found of await focusProblems(page)) problems.push(`${url}: ${found}`);
  }
  expect(problems).toEqual([]);
});

test("the checks report a seeded Chinese word, overflow and unmarked focus", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const wide = document.createElement("button");
    wide.textContent = "好";
    wide.style.cssText = "width: 3000px; outline: none; box-shadow: none";
    document.body.append(wide);
  });
  expect(await chineseOutsideZh(page)).toHaveLength(1);
  expect(await horizontalOverflow(page)).toBeGreaterThan(0);
  expect(await focusProblems(page)).toContainEqual(expect.stringMatching(/^no focus indicator /));
});

test("axe reports a seeded violation", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const image = document.createElement("img");
    image.src = "/icon.svg";
    document.body.append(image);
  });
  expect(await accessibilityViolations(page)).toContainEqual(expect.stringMatching(/^image-alt /));
});
