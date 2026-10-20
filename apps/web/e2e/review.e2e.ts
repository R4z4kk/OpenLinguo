import { expect, type Locator, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

/** Fills `{{name}}` and `{{name, number}}` with numbers below 1,000. */
const fill = (template: string, values: Readonly<Record<string, number>>): string =>
  template.replace(/\{\{(\w+)(?:, number)?\}\}/gu, (placeholder, name: string) =>
    String(values[name] ?? placeholder),
  );

const goalCount = (done: number, goal: number): string => fill(en.today.goalCount, { done, goal });

/** Reloads in each theme: WebKit keeps inherited colors stale after a live scheme switch. */
const expectAccessibleInBothThemes = async (page: Page, ready: Locator): Promise<void> => {
  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.reload();
    await expect(ready).toBeVisible();
    expect(await accessibilityViolations(page)).toEqual([]);
  }
};

test("reviews my word first from the keyboard, then a band word", async ({ page }) => {
  const main = page.getByRole("main");
  const focused = page.locator(":focus");
  const progress = main.getByRole("progressbar", { name: en.review.progress });

  await page.goto("/learn/dictionary/你好");
  const myWords = main.getByRole("checkbox", { name: en.decks.myWords });
  await expect(myWords).toBeEnabled({ timeout: 90_000 });
  await myWords.click();
  await expect(myWords).toBeChecked();

  await page.getByRole("link", { name: en.nav.today }).click();
  await expect(main).toContainText(goalCount(0, 20));
  await main.getByRole("link", { name: en.today.start }).click();
  await expect(focused).toContainText(en.review.recognition);
  await expect(focused).toContainText("你好");
  await expect(progress).toHaveAttribute("value", "0");
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.keyboard.press("Space");
  await expect(focused).toContainText("nǐ");
  await expect(focused).toContainText("hello; hi");
  await expect(main.getByRole("button", { name: `${en.review.grades.good} 10 min` })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  // Easy ends the new card's learning: its word is done for the day.
  await page.keyboard.press("4");
  await expect(progress).toHaveAttribute("value", "1");
  await expect(focused).toContainText(en.review.recognition);
  await expect(focused).not.toContainText("你好");
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.getByRole("link", { name: en.nav.today }).click();
  await expect(main.getByRole("progressbar", { name: en.today.goal })).toHaveAttribute(
    "value",
    "1",
  );
  await expect(main).toContainText(goalCount(1, 20));
  await expect(
    main.getByText(fill(en.progress.days_other, { count: 0 }), { exact: true }),
  ).toBeVisible();
  const xp = main.getByText(fill(en.progress.xpCount, { xp: 10 }), { exact: true });
  await expect(xp).toBeVisible();
  await expectAccessibleInBothThemes(page, xp);

  await page.getByRole("link", { name: en.nav.profile }).click();
  const level = main.getByText(fill(en.progress.level, { level: 1 }), { exact: true });
  await expect(level).toBeVisible();
  await expect(main.getByRole("progressbar", { name: en.progress.levelProgress })).toHaveAttribute(
    "value",
    "10",
  );
  await expect(main).toContainText(
    fill(en.progress.toNextLevel, { done: 10, total: 100, next: 2 }),
  );
  await expect(main.getByRole("heading", { level: 3, name: en.progress.achievements })).toHaveText(
    `${en.progress.achievements} ${fill(en.progress.achievementCount, { earned: 1, total: 16 })}`,
  );
  await expect(main.getByRole("listitem")).toHaveText([
    fill(en.progress.milestones.reviews_one, { count: 1 }),
  ]);
  await expect(main.getByText(en.stats.notYet, { exact: true })).toBeVisible();
  await expect(main).toContainText(fill(en.stats.studiedDays_one, { count: 1, days: 30 }));
  const showNumbers = page.getByText(en.stats.showNumbers);
  await expectAccessibleInBothThemes(
    page,
    main
      .filter({ has: page.getByText(fill(en.progress.level, { level: 1 }), { exact: true }) })
      .filter({ has: showNumbers }),
  );
  await showNumbers.click();
  await expect(main.getByRole("table").getByRole("cell", { name: "1", exact: true })).toHaveCount(
    1,
  );
  expect(await accessibilityViolations(page)).toEqual([]);
  const smallGoal = main
    .getByRole("group", { name: en.goal.dailyGoal })
    .getByRole("radio", { name: "10", exact: true });
  await smallGoal.focus();
  await page.keyboard.press("Space");
  await expect(smallGoal).toBeChecked();
  await page.getByRole("link", { name: en.nav.today }).click();
  await expect(main).toContainText(goalCount(1, 10));
  await expect(main).not.toContainText(en.today.goalMet);
});

test("hides streak, XP and achievements, and counts the words done meanwhile", async ({ page }) => {
  const main = page.getByRole("main");
  const show = main.getByRole("checkbox", { name: en.progress.show });
  const progressTitle = main.getByRole("heading", { level: 2, name: en.progress.title });
  const xp = main.getByText(fill(en.progress.xpCount, { xp: 10 }), { exact: true });

  await page.goto("/learn/dictionary/你好");
  const myWords = main.getByRole("checkbox", { name: en.decks.myWords });
  await expect(myWords).toBeEnabled({ timeout: 90_000 });
  await myWords.click();
  await expect(myWords).toBeChecked();

  await page.getByRole("link", { name: en.nav.profile }).click();
  await expect(progressTitle).toBeVisible();
  await show.focus();
  await page.keyboard.press("Space");
  await expect(show).not.toBeChecked();
  await expect(progressTitle).toBeHidden();
  await expect(main.getByRole("heading", { level: 2, name: en.stats.title })).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.getByRole("link", { name: en.nav.today }).click();
  await main.getByRole("link", { name: en.today.start }).click();
  await expect(page.locator(":focus")).toContainText("你好");
  await page.keyboard.press("Space");
  await expect(page.locator(":focus")).toContainText("hello; hi");
  await page.keyboard.press("4");
  await expect(main.getByRole("progressbar", { name: en.review.progress })).toHaveAttribute(
    "value",
    "1",
  );
  await page.getByRole("link", { name: en.nav.today }).click();
  await expect(main).toContainText(goalCount(1, 20));
  await expect(main.getByRole("term")).toHaveCount(0);

  await page.getByRole("link", { name: en.nav.profile }).click();
  await show.check();
  await expect(main.getByRole("progressbar", { name: en.progress.levelProgress })).toHaveAttribute(
    "value",
    "10",
  );
  await page.getByRole("link", { name: en.nav.today }).click();
  await expect(xp).toBeVisible();
});

test("counts words: a card that comes back keeps the total, then tomorrow's session starts now", async ({
  page,
}) => {
  const main = page.getByRole("main");
  const focused = page.locator(":focus");
  const progress = main.getByRole("progressbar", { name: en.review.progress });
  const words = (done: number) => fill(en.review.progressCount_other, { done, count: 5 });
  const grade = async (key: string) => {
    await expect(main.getByRole("button", { name: en.review.showAnswer })).toBeVisible();
    await page.keyboard.press("Space");
    await expect(main.getByRole("button", { name: /^Good/u })).toBeVisible();
    await page.keyboard.press(key);
  };
  // Far from the 4:00 rollover, a new card graded Good is due again the same day.
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  await page.clock.setFixedTime(noon);
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("openlinguo.newCardsPerDay", "5");
  });

  await page.goto("/review");
  await expect(focused).toContainText(en.review.recognition, { timeout: 90_000 });
  await expect(main).toContainText(words(0));
  for (let pass = 0; pass < 5; pass += 1) await grade("3");
  // Each card comes back once: no word is done yet, and the total stays.
  await expect(main.getByRole("button", { name: en.review.showAnswer })).toBeVisible();
  await expect(main).toContainText(words(0));
  await expect(progress).toHaveAttribute("value", "0");
  for (let pass = 1; pass <= 4; pass += 1) {
    await grade("3");
    await expect(progress).toHaveAttribute("value", String(pass));
  }
  await grade("3");
  await expect(focused).toContainText(en.challenge.title);
  await main.getByRole("button", { name: en.challenge.skip }).focus();
  await page.keyboard.press("Enter");
  await expect(focused).toContainText("Session finished: 5 words.");
  await expect(main).toContainText(en.review.aheadHint);
  expect(await accessibilityViolations(page)).toEqual([]);

  // Tomorrow's 5 new words now; today's words wait for tomorrow.
  await main.getByRole("button", { name: en.review.ahead }).click();
  await expect(focused).toContainText(en.review.recognition);
  await expect(main).toContainText(words(0));
  await grade("4");
  await expect(progress).toHaveAttribute("value", "1");

  await page.getByRole("link", { name: en.nav.today }).click();
  await expect(main).toContainText(goalCount(6, 20));
  await expect(
    main.getByText(fill(en.progress.xpCount, { xp: 110 }), { exact: true }),
  ).toBeVisible();
});
