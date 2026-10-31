import { expect } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { fr } from "../src/i18n/fr.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";
import { put } from "./seed.ts";

const SENTENCE = "我们去学校。";
const MARKED_WORD = { headword: "我们", readingKey: "wo3 men5", markedAt: 1 };
/** 我們說那裡的風景很美。她們買了禮物。 in GB18030 (.NET code page 54936); not valid UTF-8. */
const TRADITIONAL_GB18030 = Buffer.from(
  "ced28283d566c4c7d165b5c4ef4cbeb0badcc3c0a1a3cbfd8283d949c1cbb659ceefa1a3",
  "hex",
);

test("pastes a text, shows its share of known words and deletes it with the keyboard", async ({
  page,
}) => {
  const main = page.getByRole("main");
  await page.goto("/read");
  await expect(main.getByText(en.library.emptyTitle)).toBeVisible({ timeout: 90_000 });
  expect(await accessibilityViolations(page)).toEqual([]);

  const paste = main.getByRole("link", { name: en.library.paste });
  await paste.focus();
  await page.keyboard.press("Enter");
  const body = main.getByRole("textbox", { name: en.library.bodyLabel });
  await expect(main.getByRole("heading", { level: 1, name: en.library.pasteTitle })).toBeVisible();
  await expect(body).toBeFocused();
  await page.keyboard.type(SENTENCE);
  await expect(main.getByText("6 characters of 20,000")).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.keyboard.press("Shift+Tab");
  await expect(main.getByRole("textbox", { name: en.library.titleLabel })).toBeFocused();
  await page.keyboard.type("周末");
  await page.keyboard.press("Tab");
  await expect(body).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(main.getByRole("button", { name: en.library.save })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(main.getByRole("status").filter({ hasText: "周末" })).toHaveText(
    en.library.saved.replace("{{title}}", "周末"),
  );
  const rows = main.getByRole("listitem");
  await expect(rows).toHaveCount(1);
  await expect(rows.getByRole("heading", { level: 3 })).toHaveText("周末");
  await expect(rows).toContainText("pasted");
  await expect(rows).toContainText("0% of words known · 3 words to learn", { timeout: 60_000 });
  expect(await accessibilityViolations(page)).toEqual([]);

  // A reading marked « I know it » counts at once.
  await put(page, "knownMarks", MARKED_WORD);
  await page.reload();
  await expect(rows).toContainText("33% of words known · 2 words to learn", { timeout: 90_000 });

  const remove = main.getByRole("button", { name: "Delete the text “周末”" });
  await remove.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: en.library.deleteTitle });
  await expect(dialog).toContainText("will be removed from this device");
  await expect(dialog.getByRole("button", { name: en.library.cancel })).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();
  await expect(rows).toHaveCount(1);

  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: en.library.deleteConfirm })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(main.getByRole("status").filter({ hasText: en.library.deleted })).toBeVisible();
  await expect(main.getByText(en.library.emptyTitle)).toBeVisible();
  await expect(main.getByRole("heading", { level: 2, name: en.library.listTitle })).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("imports a .txt read as GB18030 and warns about traditional characters", async ({ page }) => {
  const main = page.getByRole("main");
  await page.goto("/read");
  const upload = main.getByRole("button", { name: en.library.import });
  await expect(upload).toBeVisible({ timeout: 90_000 });
  await page.locator('input[type="file"]').setInputFiles({
    name: "新闻.txt",
    mimeType: "text/plain",
    buffer: TRADITIONAL_GB18030,
  });

  await expect(main.getByRole("heading", { level: 1, name: en.library.importTitle })).toBeVisible();
  await expect(main.locator("p", { hasText: "新闻.txt" })).toContainText("Read as GB18030");
  await expect(main.getByText(en.library.gb18030Help)).toBeVisible();
  const body = main.getByRole("textbox", { name: en.library.bodyLabel });
  await expect(body).toHaveValue("我們說那裡的風景很美。她們買了禮物。");
  const notice = main.getByText(en.library.traditionalTitle);
  await expect(notice).toBeVisible();
  await expect(body).toHaveAccessibleDescription(new RegExp(en.library.traditionalBody, "u"));
  const save = main.getByRole("button", { name: en.library.save });
  await expect(save).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.keyboard.press("Enter");
  const rows = main.getByRole("listitem");
  await expect(rows.getByRole("heading", { level: 3 })).toHaveText("我們說那裡的風景很美。她…");
  await expect(rows).toContainText(".txt file");
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("refuses a file that is not text, and a text over the limit until it is cut", async ({
  page,
}) => {
  const main = page.getByRole("main");
  await page.goto("/read");
  await expect(main.getByRole("button", { name: en.library.import })).toBeVisible({
    timeout: 90_000,
  });
  const file = page.locator('input[type="file"]');
  await file.setInputFiles({
    name: "image.txt",
    mimeType: "text/plain",
    buffer: Buffer.from([0x81, 0x20, 0x81, 0x20]),
  });
  await expect(main.getByRole("alert")).toHaveText(en.library.fileFailed.unreadable);
  expect(await accessibilityViolations(page)).toEqual([]);

  await file.setInputFiles({
    name: "journal.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("好".repeat(20_003), "utf8"),
  });
  const body = main.getByRole("textbox", { name: en.library.bodyLabel });
  await expect(body).toHaveAttribute("aria-invalid", "true");
  const save = main.getByRole("button", { name: en.library.save });
  await expect(save).toBeFocused();
  await expect(save).toHaveAttribute("aria-disabled", "true");
  const reason = "This text is 20,003 characters long; the limit is 20,000. Remove 3 to save it.";
  await expect(save).toHaveAccessibleDescription(reason);
  await expect(main.getByText("20,003 characters of 20,000")).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.keyboard.press("Enter");
  await expect(main.getByRole("heading", { level: 1, name: en.library.importTitle })).toBeVisible();

  await body.focus();
  await page.keyboard.press("Control+End");
  for (let cut = 0; cut < 3; cut += 1) await page.keyboard.press("Backspace");
  await expect(body).toHaveAttribute("aria-invalid", "false");
  await expect(save).not.toHaveAttribute("aria-disabled", "true");
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(main.getByRole("listitem")).toHaveCount(1, { timeout: 30_000 });
});

test("asks to delete a text in French", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("openlinguo.language", "fr");
  });
  const main = page.getByRole("main");
  await page.goto("/read");
  await expect(main.getByRole("heading", { level: 1, name: fr.read.title })).toBeVisible({
    timeout: 90_000,
  });
  await put(page, "texts", {
    id: "00000000-0000-4000-8000-000000000001",
    title: "小花和大雨",
    body: "小花在家。外面下大雨。",
    source: "ai",
    createdAt: Date.UTC(2026, 9, 20, 10),
    provenance: {
      origin: "ai",
      provider: "groq",
      model: "openai/gpt-oss-120b",
      promptVersion: "zh-story-v1",
      createdAt: "2026-10-20T10:00:00.000Z",
    },
    readingChoices: {},
  });
  await page.goto("/read");

  const row = main.getByRole("listitem");
  await expect(row).toContainText("20 oct. 2026 · écrit par l’IA");
  await expect(row).toContainText("Généré par IA · openai/gpt-oss-120b");
  await expect(row).toContainText("de mots connus");
  expect(await accessibilityViolations(page)).toEqual([]);
  const remove = main.getByRole("button", { name: "Supprimer le texte « 小花和大雨 »" });
  await remove.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: fr.library.deleteTitle });
  await expect(dialog).toContainText("« 小花和大雨 » sera supprimé de cet appareil");
  await expect(dialog.getByRole("button", { name: fr.library.cancel })).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);
});
