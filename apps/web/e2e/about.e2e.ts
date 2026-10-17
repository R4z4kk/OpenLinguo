import { expect } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { test } from "./app.ts";

test("the About page opens the third-party notices, under the service worker too", async ({
  page,
}) => {
  await page.goto("/profile/about");
  const title = page.getByRole("heading", { level: 1, name: en.about.title });
  await expect(title).toBeVisible({ timeout: 90_000 });
  await expect
    .poll(
      () =>
        page.evaluate(
          async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? null,
        ),
      { message: "service worker activated", timeout: 30_000 },
    )
    .toBe("activated");
  await page.reload();
  await expect(title).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  await page.getByRole("link", { name: en.about.noticesLink }).click();
  await expect(page).toHaveURL(/\/THIRD-PARTY-NOTICES\.txt$/u);
  const notices = page.locator("body");
  await expect(notices).toContainText("third-party code shipped in the app");
  await expect(notices).toContainText("react 19.");
  await expect(notices).toContainText("workbox-precaching");
});
