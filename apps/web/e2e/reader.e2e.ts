import { expect, type Locator, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { fr } from "../src/i18n/fr.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";
import { put } from "./seed.ts";

const TEXT_ID = "00000000-0000-4000-8000-0000000000a1";
/** 我们 is marked known, 和 has several readings; 学校。 and 你好！ end on closing punctuation. */
const BODY = "我们和他去学校。你好！\n\n他说：“你好。”";
const MARKED_WORD = { headword: "我们", readingKey: "wo3 men5", markedAt: 1 };
/** Words: 我们 和 他 去 学校 你好 他 说 你好; known: 我们. */
const WORDS = 9;

const seed = async (page: Page, language: "en" | "fr" = "en"): Promise<void> => {
  const main = page.getByRole("main");
  await page.goto("/read");
  await expect(main.getByText((language === "en" ? en : fr).library.emptyTitle)).toBeVisible({
    timeout: 90_000,
  });
  await put(page, "texts", {
    id: TEXT_ID,
    title: "周末",
    body: BODY,
    source: "paste",
    createdAt: Date.UTC(2026, 9, 21, 10),
    provenance: null,
    readingChoices: {},
  });
  await put(page, "knownMarks", MARKED_WORD);
};

/** Picks a radio the way a keyboard user does. */
const choose = async (page: Page, radio: Locator): Promise<void> => {
  await radio.focus();
  await page.keyboard.press("Space");
};

/** From the library to the reader with the keyboard only. */
const openReader = async (page: Page): Promise<Locator> => {
  const main = page.getByRole("main");
  await page.goto("/read");
  const link = main.getByRole("link", { name: "周末" });
  await expect(link).toBeVisible({ timeout: 90_000 });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(main.getByRole("heading", { level: 1, name: "周末" })).toBeVisible();
  const passage = main.locator("p[lang='zh-Hans']");
  await expect(passage.first()).toBeVisible({ timeout: 60_000 });
  return main;
};

test("reads a text word by word with the keyboard", async ({ page }) => {
  await seed(page);
  const main = await openReader(page);
  const words = main.locator("p[lang='zh-Hans'] button");
  const radios = main.getByRole("radio");

  await expect(main.locator("p[lang='zh-Hans']")).toHaveCount(2);
  await expect(words).toHaveCount(WORDS);
  const first = main.locator("p[lang='zh-Hans']").first();
  await expect(first.getByRole("button")).toHaveCount(6);
  await expect(first).toContainText("。");
  await expect(first).toContainText("！");
  await expect(main.getByText("11%")).toBeVisible();
  await expect(main.getByText("target 98%: 87 points short.")).toBeVisible();
  await expect(main.getByText("6 words to learn.")).toBeVisible();
  await expect(main.getByText(en.reader.keyboardHint)).toBeVisible();
  await expect(radios.nth(1)).toBeChecked();
  expect(await accessibilityViolations(page)).toEqual([]);

  // One tab stop: Tab from the control enters the text, the others are skipped.
  await expect(main.locator("p button[tabindex='0']")).toHaveCount(1);
  await radios.nth(1).focus();
  await page.keyboard.press("Tab");
  await expect(words.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(words.nth(2)).toBeFocused();
  await page.keyboard.press("End");
  await expect(words.nth(WORDS - 1)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(words.nth(WORDS - 1)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(words.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Tab");
  await expect(main.locator("p button:focus")).toHaveCount(0);
  await page.keyboard.press("Shift+Tab");
  await expect(words.nth(2)).toBeFocused();

  // Enter opens the word sheet; Escape closes it and the word has focus again.
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "他" });
  await expect(sheet).toBeVisible();
  await expect(words.nth(2)).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(words.nth(2)).toBeFocused();
  await expect(main.locator("p button[aria-current]")).toHaveCount(0);
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("shows pinyin on unknown words, on every word or nowhere, and remembers it", async ({
  page,
}) => {
  await seed(page);
  const main = await openReader(page);
  const marks = main.locator("p rt");
  const polyphone = main.locator("p button", { hasText: "和" });

  // 我们 is known: no pinyin over it.
  await expect(marks.first()).toBeVisible();
  const words = main.locator("p[lang='zh-Hans'] button");
  await expect(words.nth(0).locator("rt")).toHaveCount(0);
  await expect(words.nth(4).locator("rt")).toHaveCount(2);
  await expect(polyphone).toHaveAccessibleDescription(
    `${en.reader.unknownWord} ${en.reader.severalReadings}`,
  );
  expect(await accessibilityViolations(page)).toEqual([]);

  await choose(page, main.getByRole("radio", { name: en.reader.pinyin.all }));
  await expect(words.nth(0).locator("rt")).toHaveCount(2);
  expect(await accessibilityViolations(page)).toEqual([]);

  await choose(page, main.getByRole("radio", { name: en.reader.pinyin.none }));
  await expect(marks).toHaveCount(0);
  // No pinyin, no polyphone mark.
  await expect(polyphone).toHaveAccessibleDescription(en.reader.unknownWord);
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.reload();
  await expect(main.getByRole("radio", { name: en.reader.pinyin.none })).toBeChecked({
    timeout: 90_000,
  });
  await expect(main.locator("p rt")).toHaveCount(0);
});

test("follows the target of the profile and speaks French", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("openlinguo.language", "fr");
  });
  await seed(page, "fr");
  await page.goto("/profile");
  const radio = page.getByRole("radio", { name: "95", exact: true });
  await expect(radio).toBeVisible({ timeout: 90_000 });
  await choose(page, radio);

  const main = await openReader(page);
  await expect(main.getByText("objectif 95 % : il manque 84 points.")).toBeVisible();
  await expect(main.locator("p button", { hasText: "和" })).toHaveAccessibleDescription(
    `${fr.reader.unknownWord} ${fr.reader.severalReadings}`,
  );
  await expect(main.getByRole("radio", { name: fr.reader.pinyin.unknown })).toBeChecked();
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("keeps closing punctuation on the line of its word, with the spacing of 1.4.12 and at 320 px", async ({
  page,
}) => {
  await seed(page);
  const main = await openReader(page);
  await choose(page, main.getByRole("radio", { name: en.reader.pinyin.all }));
  await page.setViewportSize({ width: 320, height: 640 });
  // The text spacing of 1.4.12 as a user style sheet: the CSP forbids inline styles.
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }",
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
  // `content-visibility: auto` may skip a paragraph below the screen and keep its old height.
  await page.evaluate(async () => {
    const frame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));
    for (const paragraph of document.querySelectorAll("p[lang='zh-Hans']")) {
      paragraph.scrollIntoView();
      await frame();
      await frame();
    }
  });

  const layout = await page.evaluate(() => {
    const overlaps = (a: DOMRect, b: DOMRect): boolean =>
      a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    // Each pinyin must clear every character and every other pinyin, its own character apart.
    const boxes = [...document.querySelectorAll("p ruby")].flatMap((ruby) =>
      [...ruby.childNodes].flatMap((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return [{ node, text: node.textContent ?? "", rect: range.getBoundingClientRect() }];
      }),
    );
    const collisions = boxes.flatMap((one) =>
      one.node.nodeName === "RT"
        ? boxes
            .filter(
              (other) =>
                other.node !== one.node &&
                other.node !== one.node.previousSibling &&
                overlaps(one.rect, other.rect),
            )
            .map((other) => `${one.text} over ${other.text}`)
        : [],
    );
    const stranded = [...document.querySelectorAll("p span.whitespace-nowrap")].filter((group) => {
      const button = group.querySelector("button");
      const closing = group.lastChild;
      if (button === null || closing === null || closing.nodeType !== Node.TEXT_NODE) return false;
      const range = document.createRange();
      range.selectNodeContents(closing);
      return range.getBoundingClientRect().top >= button.getBoundingClientRect().bottom - 1;
    }).length;
    const clipped = [...document.querySelectorAll("p")].filter(
      (node) => node.scrollHeight > node.clientHeight + 1,
    ).length;
    return {
      collisions,
      stranded,
      clipped,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(layout).toEqual({ collisions: [], stranded: 0, clipped: 0, overflow: 0 });
  expect(await accessibilityViolations(page)).toEqual([]);
});
