import { expect } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { test } from "./app.ts";

test("searches a word, opens it, then reloads it offline", async ({ page, server }) => {
  const expectWordPage = async (): Promise<void> => {
    await expect(page.getByRole("heading", { level: 1, name: "你 nǐ 好 hǎo" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: /^hello; hi$/ })).toBeVisible();
    await expect(
      page.getByRole("img", { name: en.word.strokeImage.replace("{{character}}", "你") }),
    ).toBeVisible();
  };

  await page.goto("/learn/dictionary");
  const search = page.getByRole("searchbox", { name: en.dictionary.label });
  await expect(search).toBeVisible({ timeout: 90_000 });
  await search.fill("ni hao");
  await page.getByRole("link", { name: "你好", exact: true }).click();
  await expectWordPage();

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
  await page.reload();
  await expectWordPage();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
});
