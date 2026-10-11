import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

const PACKAGE = fileURLToPath(
  new URL("../fixtures/anki/anki-26.09.3-latest.apkg", import.meta.url),
);

const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replace(/\{\{(\w+)\}\}/gu, (placeholder, name: string) =>
    String(values[name] ?? placeholder),
  );

const deck = (page: Page, name: string) =>
  page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

test("imports an Anki deck with its sounds, lists the notes left out, then plays a sound", async ({
  page,
}) => {
  const main = page.getByRole("main");
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/learn");
  const importLink = main.getByRole("link", { name: en.decks.importAnki });
  await expect(importLink).toBeVisible({ timeout: 90_000 });
  await importLink.click();
  const chooser = page.waitForEvent("filechooser");
  await main.getByRole("button", { name: en.ankiImport.choose }).click();
  await (await chooser).setFiles(PACKAGE);

  const words = (count: number) =>
    main.getByText(
      fill(count === 1 ? en.ankiImport.words_one : en.ankiImport.words_other, { count }),
    );
  await expect(words(7)).toBeVisible();
  const chinese = main.getByRole("region", {
    name: fill(en.ankiImport.noteType, { name: "Chinese test" }),
  });
  for (const [role, field] of [
    ["characters", "Hanzi"],
    ["pinyin", "Pinyin"],
    ["meaning", "Meaning"],
    ["audio", "Audio"],
  ] as const) {
    await expect(
      chinese.getByRole("combobox", { name: en.ankiImport.roles[role] }).locator("option:checked"),
    ).toHaveText(field);
  }
  await expect(chinese.getByRole("table")).toContainText("谢谢xie4 xie5thanksxiexie.mp3");
  await main.getByText(fill(en.ankiImport.unmatched_other, { count: 2 })).click();
  await expect(main.getByRole("listitem").filter({ hasText: "不存在词语" })).toContainText(
    en.ankiImport.reasons["not-found"],
  );
  expect(await accessibilityViolations(page)).toEqual([]);

  const basic = main.getByRole("region", {
    name: fill(en.ankiImport.noteType, { name: "Basic test" }),
  });
  await basic
    .getByRole("combobox", { name: en.ankiImport.roles.characters })
    .selectOption({ label: en.ankiImport.leftOut });
  await expect(words(6)).toBeVisible();
  await expect(main.getByText(fill(en.ankiImport.ignored_one, { count: 1 }))).toBeVisible();

  const name = main.getByRole("textbox", { name: en.ankiImport.deckName });
  await expect(name).toHaveValue("HSK test::Level 1");
  await main.getByRole("button", { name: en.ankiImport.import, exact: true }).click();
  await expect(
    main.getByRole("status").filter({
      hasText: fill(en.ankiImport.imported, { name: "HSK test::Level 1", words: 6, audio: 4 }),
    }),
  ).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  await main.getByRole("link", { name: en.ankiImport.backToLearn }).click();
  await expect(deck(page, "HSK test::Level 1").getByRole("definition")).toHaveText([
    "12",
    "0",
    "0",
  ]);

  // The imported words come first; 你好 ("hello; hi") carries the only playable sound.
  await page.getByRole("link", { name: en.nav.today }).click();
  await main.getByRole("link", { name: en.today.start }).click();
  const good = main.getByRole("button", { name: new RegExp(`^${en.review.grades.good}`, "u") });
  for (let card = 0; card < 6; card++) {
    await expect(main.getByRole("button", { name: en.review.showAnswer })).toBeVisible();
    await page.keyboard.press("Space");
    await expect(good).toBeVisible();
    if ((await main.getByText("hello; hi").count()) > 0) break;
    await page.keyboard.press("3");
  }
  await expect(main.getByText("hello; hi")).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  await main.getByRole("button", { name: en.review.playAudio }).click();
  // A refused source (CSP, unsupported data) rejects `play()` within a few frames.
  await page.waitForTimeout(1000);
  await expect(main.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});
