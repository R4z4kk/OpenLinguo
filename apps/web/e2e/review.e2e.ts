import { expect, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

/** Fills `{{name}}` and `{{name, number}}` with numbers below 1,000. */
const fill = (template: string, values: Readonly<Record<string, number>>): string =>
  template.replace(/\{\{(\w+)(?:, number)?\}\}/gu, (placeholder, name: string) =>
    String(values[name] ?? placeholder),
  );

const goalCount = (done: number, goal: number): string => fill(en.today.goalCount, { done, goal });

/** Reduced motion skips the color transitions axe would otherwise sample midway. */
const expectAccessibleInBothThemes = async (page: Page): Promise<void> => {
  for (const colorScheme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
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

  await page.keyboard.press("3");
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
  await expect(
    main.getByText(fill(en.progress.xpCount, { xp: 10 }), { exact: true }),
  ).toBeVisible();
  await expectAccessibleInBothThemes(page);

  await page.getByRole("link", { name: en.nav.profile }).click();
  await expect(
    main.getByText(fill(en.progress.level, { level: 1 }), { exact: true }),
  ).toBeVisible();
  await expect(main.getByRole("progressbar", { name: en.progress.levelProgress })).toHaveAttribute(
    "value",
    "10",
  );
  await expect(main).toContainText(
    fill(en.progress.toNextLevel, { done: 10, total: 100, next: 2 }),
  );
  await expect(main.getByRole("heading", { level: 3 })).toHaveText(
    `${en.progress.achievements} ${fill(en.progress.achievementCount, { earned: 1, total: 16 })}`,
  );
  await expect(main.getByRole("listitem")).toHaveText([
    fill(en.progress.milestones.reviews_one, { count: 1 }),
  ]);
  await expectAccessibleInBothThemes(page);
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
