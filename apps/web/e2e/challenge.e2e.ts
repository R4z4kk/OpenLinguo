import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

const sentence = (number: number): string =>
  en.challenge.sentence.replace("{{number}}", String(number));

const storedChallenges = (page: Page): Promise<unknown> =>
  page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const request = open.result.transaction("challenges").objectStore("challenges").getAll();
          request.onerror = () => {
            reject(new Error(String(request.error)));
          };
          request.onsuccess = () => {
            open.result.close();
            resolve(request.result);
          };
        };
      }),
  );

test("writes the challenge with the app's pinyin and the device keyboard, then finds it again", async ({
  page,
}) => {
  const main = page.getByRole("main");
  const focused = page.locator(":focus");
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  await page.clock.setFixedTime(noon);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("openlinguo.newCardsPerDay", "5");
  });

  await page.goto("/review");
  for (let done = 0; done < 5; done += 1) {
    await expect(focused).toContainText(en.review.recognition, { timeout: 90_000 });
    await page.keyboard.press("Space");
    await expect(main.getByRole("button", { name: /^Easy/u })).toBeVisible();
    await page.keyboard.press("4");
  }

  // The fifth word is the latest started today: the challenge ends the session.
  await expect(focused).toContainText(en.challenge.title);
  await expect(main.getByRole("region", { name: en.challenge.title })).toContainText(
    en.challenge.intro,
  );
  await expect(main.getByRole("link", { name: en.challenge.providerLink })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.keyboard.press("Tab");
  const appIme = main.getByRole("radio", { name: en.challenge.appIme });
  await expect(appIme).toBeFocused();
  await expect(appIme).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(main.getByRole("combobox", { name: sentence(1) })).toBeFocused();
  await page.keyboard.type("dianhua");
  await expect(
    main.getByRole("listbox", { name: en.ime.candidates }).getByRole("option").first(),
  ).toHaveText("电话");
  await page.keyboard.press("Space");
  await page.keyboard.type("?");
  await expect(main.getByText("电话？", { exact: true })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.keyboard.press("Shift+Tab");
  await expect(appIme).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(main.getByRole("radio", { name: en.challenge.deviceKeyboard })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(main.getByRole("textbox", { name: sentence(1) })).toHaveValue("电话？");
  await page.keyboard.press("Tab");
  await expect(main.getByRole("textbox", { name: sentence(2) })).toBeFocused();
  await page.keyboard.type("我没有电话。");
  for (let field = 3; field <= 5; field += 1) await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(main.getByRole("button", { name: en.challenge.save })).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(focused).toContainText("Session finished: 5 reviews.");

  const [stored] = z.array(z.unknown()).parse(await storedChallenges(page));
  expect(stored).toMatchObject({ sentences: ["电话？", "我没有电话。", "", "", ""] });

  // Opened again today: the saved sentences, typed with the keyboard chosen last.
  await page.reload();
  await expect(focused).toContainText(en.challenge.title, { timeout: 90_000 });
  await expect(main.getByRole("radio", { name: en.challenge.deviceKeyboard })).toBeChecked();
  await expect(main.getByRole("textbox", { name: sentence(2) })).toHaveValue("我没有电话。");

  await page.getByRole("link", { name: en.nav.learn }).click();
  await main.getByRole("link", { name: new RegExp(en.challenge.listTitle, "u") }).click();
  const saved = main.getByRole("listitem").getByRole("link");
  await expect(saved).toHaveCount(1);
  await expect(saved).toContainText("电话？");
  expect(await accessibilityViolations(page)).toEqual([]);
  await saved.focus();
  await page.keyboard.press("Enter");
  await expect(main.getByRole("heading", { level: 1, name: en.challenge.title })).toBeVisible();
  await expect(main.getByRole("button", { name: en.challenge.skip })).toHaveCount(0);
  const third = main.getByRole("textbox", { name: sentence(3) });
  await third.focus();
  await page.keyboard.type("电话很好。");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(main.getByRole("button", { name: en.challenge.save })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(main.getByRole("status")).toHaveText(en.challenge.saved);
  expect(await accessibilityViolations(page)).toEqual([]);
  const [edited] = z.array(z.unknown()).parse(await storedChallenges(page));
  expect(edited).toMatchObject({ sentences: ["电话？", "我没有电话。", "电话很好。", "", ""] });
});
