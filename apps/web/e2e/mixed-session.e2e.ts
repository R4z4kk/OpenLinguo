import { cardId, CardState, replay, Review, type WordKey } from "@openlinguo/core";
import { expect, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";
import { startCards } from "./cards.ts";

const PERSON: WordKey = { headword: "人", readingKey: "ren2" };
const HELLO: WordKey = { headword: "你好", readingKey: "ni3 hao3" };
const PHONE: WordKey = { headword: "电话", readingKey: "dian4 hua4" };
const THANKS: WordKey = { headword: "谢谢", readingKey: "xie4 xie5" };

/** A card's stored state and its review log. */
const storedWithLog = async (page: Page, id: string) => {
  const stored = await page.evaluate(
    (id) =>
      new Promise<{ readonly card: unknown; readonly reviews: unknown }>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const transaction = open.result.transaction(["cards", "reviews"]);
          const card = transaction.objectStore("cards").get(id);
          const reviews = transaction.objectStore("reviews").index("cardId").getAll(id);
          transaction.onerror = () => {
            reject(new Error(String(transaction.error)));
          };
          transaction.oncomplete = () => {
            open.result.close();
            resolve({ card: card.result, reviews: reviews.result });
          };
        };
      }),
    id,
  );
  return { card: CardState.parse(stored.card), reviews: Review.array().parse(stored.reviews) };
};

test("completes a session of every card type with the keyboard only, writing and typing scheduled as their log replays", async ({
  page,
}) => {
  const main = page.getByRole("main");
  const focused = page.locator(":focus");
  const progress = main.getByRole("progressbar", { name: en.review.progress });
  const result = main.getByRole("status");
  const proceed = main.getByRole("button", { name: en.review.toneContinue });
  // Far from the 4:00 rollover, a card graded Good is due again the same day.
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  await page.clock.setFixedTime(noon);
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
  });

  // 谢谢 in my words has its recall card stored as new.
  await page.goto(`/learn/dictionary/${THANKS.headword}`);
  const myWords = main.getByRole("checkbox", { name: en.decks.myWords });
  await expect(myWords).toBeEnabled({ timeout: 90_000 });
  await myWords.click();
  await expect(myWords).toBeChecked();

  await page.goto("/learn");
  const download = main.getByRole("button", { name: /^Download the audio \(/u }).first();
  await download.click();
  await expect(main.getByText(en.audio.installed).first()).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem("openlinguo.practiceWriting", "true");
    localStorage.setItem("openlinguo.newCardsPerDay", "5");
  });
  // A word shows one card a day: its next type by id, recall, tone, typing then writing.
  await startCards(page, THANKS, ["recognition"]);
  await startCards(page, HELLO, ["recognition", "recall"]);
  await startCards(page, PHONE, ["recognition", "recall", "tone"]);
  await startCards(page, PERSON, ["recognition", "recall", "tone", "typing"]);

  await page.goto("/");
  await main.getByRole("link", { name: en.today.start }).focus();
  await page.keyboard.press("Enter");

  // 人 on paper: the switch keeps Space, Tab leads on to the stroke order.
  await expect(focused).toContainText(en.review.writingTitle);
  await expect(focused).toContainText(en.review.writingDraw);
  expect(await accessibilityViolations(page)).toEqual([]);
  const paper = main.getByRole("switch", { name: en.review.writingOnPaper });
  await page.keyboard.press("Tab");
  await expect(paper).toBeFocused();
  await page.keyboard.press("Space");
  await expect(paper).toHaveAttribute("aria-checked", "true");
  await expect(main).toContainText(en.review.writingPaper);
  await page.keyboard.press("Tab");
  await expect(main.getByRole("button", { name: en.review.playAudio })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(main.getByRole("button", { name: en.review.showStrokes })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(main.getByRole("img", { name: "Stroke order of 人" })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("4");
  await expect(progress).toHaveAttribute("value", "1");

  const answerTone = async () => {
    await expect(focused).toContainText(en.review.tone);
    await expect(focused).toContainText(HELLO.headword);
    expect(await accessibilityViolations(page)).toEqual([]);
    await page.keyboard.press("2");
    await page.keyboard.press("3");
    await expect(main.getByRole("button", { name: en.review.toneCheck })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(result).toContainText("Graded: Good");
    await expect(proceed).toBeFocused();
    expect(await accessibilityViolations(page)).toEqual([]);
    await page.keyboard.press("Enter");
  };
  await answerTone();
  await expect(progress).toHaveAttribute("value", "2");

  const answerTyping = async () => {
    await expect(focused).toContainText(en.review.typing);
    await expect(focused).not.toContainText(PHONE.headword);
    expect(await accessibilityViolations(page)).toEqual([]);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(main.getByRole("combobox", { name: en.ime.answer })).toBeFocused();
    await page.keyboard.type("dianhua");
    await expect(
      main.getByRole("listbox", { name: en.ime.candidates }).getByRole("option").first(),
    ).toHaveText(PHONE.headword);
    await page.keyboard.press("Space");
    await page.keyboard.press("Enter");
    await expect(result).toContainText("Graded: Good");
    await expect(proceed).toBeFocused();
    expect(await accessibilityViolations(page)).toEqual([]);
    await page.keyboard.press("Enter");
  };
  await answerTyping();
  await expect(progress).toHaveAttribute("value", "3");

  await expect(focused).toContainText(en.review.recall);
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Space");
  await expect(focused).toContainText("xiè");
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("4");
  await expect(progress).toHaveAttribute("value", "4");

  // The first band word, never reviewed.
  await expect(focused).toContainText(en.review.recognition);
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Space");
  await expect(main.getByRole("button", { name: /^Easy/u })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("4");
  await expect(progress).toHaveAttribute("value", "5");

  // Good leaves a new card learning: tone and typing come back once.
  await answerTone();
  await expect(progress).toHaveAttribute("value", "6");
  await answerTyping();
  // The band word was started today: its challenge comes last, and Skip ends the session.
  await expect(focused).toContainText(en.challenge.title);
  expect(await accessibilityViolations(page)).toEqual([]);
  await main.getByRole("button", { name: en.challenge.skip }).focus();
  await page.keyboard.press("Enter");
  await expect(focused).toContainText("Session finished: 7 reviews.");
  expect(await accessibilityViolations(page)).toEqual([]);

  for (const [word, type, grades] of [
    [PERSON, "writing", ["easy"]],
    [PHONE, "typing", ["good", "good"]],
  ] as const) {
    const id = cardId({ language: "zh", ...word, type });
    const { card, reviews } = await storedWithLog(page, id);
    expect(reviews.map(({ grade }) => grade)).toEqual(grades);
    expect(replay(id, reviews)).toEqual({ ok: true, value: card });
    expect(card.phase).toBe("review");
    expect(card.due).toBeGreaterThan(noon.getTime());
  }
});
