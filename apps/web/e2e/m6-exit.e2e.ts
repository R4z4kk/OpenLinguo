import { AI_BASE_URLS } from "@openlinguo/core";
import { expect } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { replay } from "./ai-replay.ts";
import { test } from "./app.ts";
import {
  confirmNotice,
  fill,
  GROQ_ANSWER,
  seed,
  SENT,
  SEQUENCES,
  settingsOf,
} from "./explain-replay.ts";
import { card, openPanel, press, rowsOf } from "./unknown-words-panel.ts";
import { recorded, replayWikidata } from "./wikidata-replay.ts";

/**
 * M6 exit (#234). The story with its coverage and its names is `story.e2e.ts` (the Groq story and
 * « proposes the names of the story »).
 */

/** Four words, none with several readings: 我们 去 学校 你好. */
const TEXT = "我们去学校。你好！";
const TITLE = "我们去学校。你好！";

test("imports a .txt, reads its coverage, and offline adds a word and marks one known", async ({
  page,
  server,
}) => {
  const main = page.getByRole("main");
  await page.goto("/read");
  await expect(main.getByText(en.library.emptyTitle)).toBeVisible({ timeout: 90_000 });
  await page.locator('input[type="file"]').setInputFiles({
    name: "周末.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(TEXT, "utf8"),
  });
  await expect(main.getByRole("heading", { level: 1, name: en.library.importTitle })).toBeVisible();
  await expect(main.getByRole("textbox", { name: en.library.bodyLabel })).toHaveValue(TEXT);
  expect(await accessibilityViolations(page)).toEqual([]);
  await press(page, main.getByRole("button", { name: en.library.save }));

  const row = main.getByRole("listitem").filter({ hasText: TITLE });
  await expect(row).toContainText(".txt file");
  await expect(row).toContainText("0% of words known · 4 words to learn", { timeout: 60_000 });
  expect(await accessibilityViolations(page)).toEqual([]);

  // The service worker serves the app once the server is gone.
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

  const link = main.getByRole("link", { name: TITLE });
  await expect(link).toBeVisible({ timeout: 60_000 });
  await press(page, link);
  const words = main.locator("p[lang='zh-Hans'] button");
  await expect(words).toHaveCount(4, { timeout: 60_000 });
  await expect(main.getByText("0%", { exact: true })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  // The arrow keys move from word to word; Enter opens the sheet.
  await words.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(words.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog");
  const status = sheet.getByRole("status");
  await expect(sheet.getByRole("heading", { level: 2, name: "去" })).toBeFocused();
  await press(page, sheet.getByRole("button", { name: en.wordSheet.add, exact: true }));
  await expect(status).toContainText(en.wordSheet.done.filed.replace("{{deck}}", en.decks.myWords));
  await expect.poll(() => rowsOf(page, "deckWords")).toHaveLength(1);
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(words.nth(1)).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(sheet.getByRole("heading", { level: 2, name: "学校" })).toBeFocused();
  await press(page, sheet.getByRole("button", { name: en.wordSheet.known, exact: true }));
  await expect(status).toHaveText(
    `${en.wordSheet.done.known} ${fill(en.wordSheet.coverage, { percent: "25%" })}`,
  );
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(main.getByText("25%", { exact: true })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
});

// Requests from a page a service worker controls escape `page.route` in WebKit.
test.describe(() => {
  test.use({ serviceWorkers: "block" });

  test("runs the cascade: Wikidata, then the AI, then the learner's choice", async ({ page }) => {
    await replayWikidata(page, () => ({ kind: "answer", body: recorded("homonyms") }));
    const sent = await replay(page, AI_BASE_URLS.groq, () => [GROQ_ANSWER]);
    await seed(page, settingsOf("groq"));
    const main = await openPanel(page);
    await expect(main.getByRole("heading", { level: 2 })).toHaveText(SEQUENCES);

    // Wikidata first: one request for the sequences it can answer.
    await press(page, main.getByRole("button", { name: en.wikidata.search }));
    await press(page, page.getByRole("button", { name: en.wikidata.notice.confirm }));
    await expect(
      main.getByRole("status").filter({
        hasText: fill(en.wikidata.checked_other, { count: SEQUENCES.length, found: 1 }),
      }),
    ).toBeVisible();
    const name = card(main, "王芳");
    await expect(
      name.getByText(`${en.unknownWords.source.wikidata} · ${en.unknownWords.kind.person}`),
    ).toHaveCount(5);
    await expect(card(main, "红白机").getByText(/^Wikidata: nothing found, /u)).toBeVisible();
    expect(await accessibilityViolations(page)).toEqual([]);

    // Then the AI, for every sequence it has not explained, Wikidata's answers kept.
    await press(page, main.getByRole("button", { name: en.aiExplain.ask }));
    await confirmNotice(page);
    await expect(
      main.getByRole("status").filter({
        hasText: fill(en.aiExplain.answered_other, { count: SENT.length }),
      }),
    ).toBeVisible();
    expect(sent).toHaveLength(1);
    const explained = name.getByRole("listitem").filter({ hasText: "Wang Fang, Chinese name" });
    await expect(explained).toContainText(
      `${en.unknownWords.source.ai} · ${en.unknownWords.kind.person}`,
    );
    await expect(
      name.getByText(`${en.unknownWords.source.wikidata} · ${en.unknownWords.kind.person}`),
    ).toHaveCount(5);
    await expect(card(main, "红白机").getByText("Nintendo Entertainment System")).toBeVisible();
    expect(await accessibilityViolations(page)).toEqual([]);

    // Nothing is applied until the learner accepts: then the name counts as known.
    expect(await rowsOf(page, "lexicon")).toEqual([]);
    await press(page, explained.getByRole("button", { name: en.unknownWords.accept }));
    await expect(main.getByRole("button", { name: en.unknownWords.undo })).toBeFocused();
    const announced = main.getByRole("status").filter({ hasText: "王芳" });
    await expect(announced).toContainText("王芳 added to your lexicon.");
    await expect(announced).toContainText(/Known words in the text: \d+%\./u);
    expect(await rowsOf(page, "lexicon")).toMatchObject([
      { headword: "王芳", kind: "person", source: "ai" },
    ]);
    expect(await accessibilityViolations(page)).toEqual([]);
  });
});
