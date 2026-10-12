import { expect } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

test("searches a word, opens it, then reloads it offline", async ({ page, server }) => {
  const expectWordPage = async (): Promise<void> => {
    await expect(page.getByRole("heading", { level: 1, name: "你 nǐ 好 hǎo" })).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: /^hello; hi$/ })).toBeVisible();
    await expect(
      page.getByRole("img", { name: en.word.strokeImage.replace("{{character}}", "你") }),
    ).toBeVisible();
  };

  // The import screen stays up until its axe check is done.
  const { promise: indexHeld, resolve: releaseIndex } = Promise.withResolvers<null>();
  await page.route("**/data/index.json", async (route) => {
    await indexHeld;
    await route.continue();
  });
  await page.goto("/learn/dictionary");
  await expect(page.getByRole("heading", { level: 1, name: en.dataImport.title })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  releaseIndex(null);

  const search = page.getByRole("searchbox", { name: en.dictionary.label });
  await expect(search).toBeVisible({ timeout: 90_000 });
  await search.fill("ni hao");
  const result = page.getByRole("link", { name: "你好", exact: true });
  await expect(result).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  await result.click();
  await expectWordPage();
  expect(await accessibilityViolations(page)).toEqual([]);

  // 𫠒 (CJK extension D) is in neither Noto Sans SC nor LXGW WenKai GB: the fallback draws it.
  await page.goto("/learn/dictionary/𫠒");
  await expect(page.getByRole("heading", { level: 1, name: "𫠒 zhāng" })).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          [...document.fonts]
            .filter((face) => face.family.replaceAll('"', "") === "OpenLinguo Han Fallback")
            .map((face) => face.status),
        ),
      { message: "fallback font loaded" },
    )
    .toContain("loaded");
  await page.goBack();
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
  expect(await accessibilityViolations(page)).toEqual([]);
});
