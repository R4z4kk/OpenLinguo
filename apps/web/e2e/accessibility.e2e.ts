import { expect } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";
import { NOT_FOUND_VISIT, ROUTE_VISITS } from "./routes.ts";

const VISITS = [...Object.values(ROUTE_VISITS), NOT_FOUND_VISIT];
const SCHEMES = ["light", "dark"] as const;

test("every route passes axe in light and dark", async ({ page }) => {
  // The dictionary import, then about 4 s per visit on CI's WebKit: grows with the routes.
  test.setTimeout(90_000 + VISITS.length * SCHEMES.length * 4_000);
  await page.goto("/learn/dictionary");
  await expect(page.getByRole("searchbox", { name: en.dictionary.label })).toBeVisible({
    timeout: 90_000,
  });
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

test("axe reports a seeded violation", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const image = document.createElement("img");
    image.src = "/icon.svg";
    document.body.append(image);
  });
  expect(await accessibilityViolations(page)).toContainEqual(expect.stringMatching(/^image-alt /));
});
