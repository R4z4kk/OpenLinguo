import { expect, type Locator, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";
import { put } from "./seed.ts";

const TEXT_ID = "00000000-0000-4000-8000-0000000000b1";
/** 丁丹妮 is a name of jieba's list, 丁母忧 a word of the extended lexicon, 我很好 only common words. */
const BODY = "我们和丁丹妮去学校。他丁母忧。我很好。";

const seed = async (page: Page): Promise<void> => {
  await page.goto("/read");
  await expect(page.getByRole("main").getByText(en.library.emptyTitle)).toBeVisible({
    timeout: 90_000,
  });
  await put(page, "texts", {
    id: TEXT_ID,
    title: "周末",
    body: BODY,
    source: "paste",
    createdAt: Date.UTC(2026, 9, 24, 10),
    provenance: null,
    readingChoices: {},
  });
};

const press = async (page: Page, target: Locator, key = "Enter"): Promise<void> => {
  await target.focus();
  await page.keyboard.press(key);
};

/** From the library to the unknown-words panel with the keyboard only. */
const openPanel = async (page: Page): Promise<Locator> => {
  const main = page.getByRole("main");
  await page.goto("/read");
  const text = main.getByRole("link", { name: "周末" });
  await expect(text).toBeVisible({ timeout: 90_000 });
  await press(page, text);
  const link = main.getByRole("link", { name: /^Unknown words in this text/ });
  await expect(link).toHaveText(/· \d+$/u, { timeout: 60_000 });
  await press(page, link);
  await expect(main.getByRole("heading", { level: 1, name: /· \d+$/u })).toBeVisible();
  return main;
};

const card = (main: Locator, sequence: string): Locator =>
  main
    .getByRole("listitem")
    .filter({ has: main.page().getByRole("heading", { level: 2, name: sequence }) });

test("lists the unknown sequences, proposes from the downloaded lists and applies what is accepted", async ({
  page,
}) => {
  await seed(page);
  const main = await openPanel(page);
  const heading = main.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(`${en.unknownWords.title} · 2`);
  await expect(main.getByRole("heading", { level: 2 })).toHaveText(["丁丹妮", "丁母忧"]);
  await expect(main.getByText(en.unknownWords.noProposal).filter({ visible: true })).toHaveCount(2);
  expect(await accessibilityViolations(page)).toEqual([]);

  // Common words are set apart, and never meant for Wikidata.
  const common = main.locator("details");
  await expect(common.locator("summary")).toHaveText("Probably common words · 1");
  await press(page, common.locator("summary"), "Enter");
  await expect(common.getByRole("heading", { level: 2, name: "我很好" })).toBeVisible();
  await expect(common.getByText(en.unknownWords.notForWikidata)).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  // The size is on the button; nothing is downloaded before it is pressed.
  const download = main.getByRole("button", { name: /^Download the lists \(\d+(\.\d)? MB\)$/u });
  await expect(download).toBeVisible();
  await expect(download).toHaveAccessibleDescription(en.unknownWords.listsIntro);
  await press(page, download);
  await expect(main.getByText(en.unknownWords.installed)).toBeVisible({ timeout: 120_000 });

  // 我很好 is in the extended lexicon: it is no longer set apart as common words.
  await expect(common).toHaveCount(0);
  await expect(heading).toHaveText(`${en.unknownWords.title} · 3`);
  await expect(
    card(main, "我很好").getByText(en.unknownWords.source["extended-lexicon"], { exact: false }),
  ).toBeVisible();

  const name = card(main, "丁丹妮");
  const word = card(main, "丁母忧");
  await expect(
    name.getByText(`${en.unknownWords.source["name-signal"]} · ${en.unknownWords.kind.person}`),
  ).toBeVisible();
  await expect(
    word.getByText(`${en.unknownWords.source["extended-lexicon"]} · ${en.unknownWords.kind.word}`),
  ).toBeVisible();
  await expect(word.getByText(/mourn the passing of one's mother/u)).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  // Accept: the card collapses, focus goes to Undo and the new coverage is announced.
  await press(page, name.getByRole("button", { name: en.unknownWords.accept }));
  const undo = main.getByRole("button", { name: en.unknownWords.undo });
  await expect(undo).toBeFocused();
  await expect(
    main
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: en.unknownWords.undo }) }),
  ).toContainText(en.unknownWords.kind.person);
  const status = main.getByRole("status").first();
  await expect(status).toContainText("丁丹妮 added to your lexicon.");
  await expect(status).toContainText(/Known words in the text: \d+%\./u);
  expect(await accessibilityViolations(page)).toEqual([]);

  // Undo gives the card back.
  await page.keyboard.press("Enter");
  await expect(status).toContainText("丁丹妮 removed from your lexicon.");
  await expect(name.getByRole("heading", { level: 2, name: "丁丹妮" })).toBeFocused();

  // Reject hides the proposal and says so.
  await press(page, name.getByRole("button", { name: en.unknownWords.reject }));
  await expect(status).toHaveText(en.unknownWords.rejected);
  await expect(name.getByText(en.unknownWords.noProposal)).toBeVisible();

  // Edit: errors are tied to the form, a valid entry is kept.
  await press(page, word.getByRole("button", { name: en.unknownWords.edit }));
  const headword = word.getByLabel(en.unknownWords.form.headword);
  await expect(headword).toBeFocused();
  await expect(headword).toHaveValue("丁母忧");
  await expect(word.getByLabel(en.unknownWords.form.reading)).toHaveValue("ding1 mu3 you1");
  await headword.fill("ding");
  await press(page, word.getByRole("button", { name: en.unknownWords.form.save }));
  await expect(word.getByRole("alert")).toHaveText(en.unknownWords.failed.notHan);
  expect(await accessibilityViolations(page)).toEqual([]);
  await headword.fill("丁母忧");
  await press(page, word.getByRole("button", { name: en.unknownWords.form.save }));
  await expect(main.getByRole("button", { name: en.unknownWords.undo })).toBeFocused();
  await expect(status).toContainText("丁母忧 added to your lexicon.");

  // Back to the text: the accepted word is one word again, and the panel no longer lists it.
  await press(page, main.getByRole("link", { name: en.unknownWords.back }));
  await expect(main.locator("p[lang='zh-Hans'] button", { hasText: "丁母忧" })).toHaveCount(1, {
    timeout: 60_000,
  });
  await expect(main.getByRole("link", { name: /^Unknown words in this text/ })).toHaveText(
    `${en.unknownWords.title} · 2`,
  );
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("keeps what the learner typed in across a reload", async ({ page }) => {
  await seed(page);
  const main = await openPanel(page);
  await press(page, card(main, "丁丹妮").getByRole("button", { name: en.unknownWords.fix }));
  await press(page, main.getByRole("button", { name: en.unknownWords.form.save }));
  await expect(main.getByRole("status").first()).toContainText("丁丹妮 added to your lexicon.");

  await page.reload();
  await expect(main.getByRole("heading", { level: 1, name: /· \d+$/u })).toHaveText(
    `${en.unknownWords.title} · 1`,
    { timeout: 60_000 },
  );
  await expect(main.getByRole("heading", { level: 2, name: "丁丹妮" })).toHaveCount(0);

  const stored = await page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const request = open.result.transaction("lexicon").objectStore("lexicon").getAll();
          request.onsuccess = () => {
            open.result.close();
            resolve(request.result);
          };
        };
      }),
  );
  expect(stored).toMatchObject([{ headword: "丁丹妮", kind: "name", source: "learner" }]);
});
