import { AI_BASE_URLS } from "@openlinguo/core";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { recording, replay } from "./ai-replay.ts";
import { test } from "./app.ts";

/** Groq's real model list and answer to the zh vocabulary prompt (scripts/record-ai.ts). */
const GROQ = recording(new URL("fixtures/ai/groq-vocabulary.json", import.meta.url));
const MODEL = GROQ.model ?? "";
const KEY = "gsk_e2e-key-for-groq-only";

const Body = z.object({ messages: z.array(z.object({ role: z.string(), content: z.string() })) });
const recordedMessages = Body.parse(
  GROQ.exchanges.find(({ request }) => request.path === "/chat/completions")?.request.body,
).messages;
const typed = z
  .object({ themes: z.array(z.string()), note: z.string() })
  .parse(JSON.parse(recordedMessages.at(-1)?.content ?? "null"));

/** The recorded headwords the E2E dictionary keeps, in the AI's order, and how many it drops. */
const KEPT = ["水", "茶", "山", "路", "吃", "树", "叶", "火"];
const DROPPED = 0;

const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replaceAll(/\{\{(\w+)\}\}/gu, (_, name: string) => String(values[name]));

const dropped = (count: number): string =>
  fill(
    count === 0
      ? en.interests.dropped_zero
      : count === 1
        ? en.interests.dropped_one
        : en.interests.dropped_other,
    { count },
  );

const deck = (page: Page, name: string) =>
  page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

// Requests from a page a service worker controls escape `page.route` in WebKit.
test.use({ serviceWorkers: "block" });

test("suggests dictionary words from the interests and files the ticked ones first", async ({
  page,
}) => {
  const sent = await replay(page, AI_BASE_URLS.groq, () => GROQ.exchanges);
  const main = page.getByRole("main");
  await page.goto("/profile");
  const interests = page.getByRole("region", { name: en.interests.title });
  await expect(
    interests.getByRole("checkbox", { name: en.interests.theme.cooking, exact: true }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(interests).toContainText(en.interests.noProvider);
  await expect(interests.getByRole("button", { name: en.interests.suggest })).toHaveCount(0);

  // Hidden without a connection, shown once the provider and its model are set, without reloading.
  const ai = page.getByRole("region", { name: en.ai.title });
  await ai.getByRole("radio", { name: en.ai.providers.groq.name }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await ai.getByLabel(en.ai.key).fill(KEY);
  await ai.getByRole("button", { name: en.ai.test }).click();
  await ai.getByLabel(en.ai.model).selectOption(MODEL);
  const suggest = interests.getByRole("button", { name: en.interests.suggest });
  await expect(suggest).toBeVisible();

  for (const theme of typed.themes) {
    await interests.getByRole("checkbox", { name: theme, exact: true }).check();
  }
  await interests.getByLabel(en.interests.note).fill(typed.note);
  await expect(suggest).toHaveAccessibleDescription(
    fill(en.aiNotice.sent, {
      provider: en.aiNotice.providers.groq,
      items: `${en.aiNotice.items.themes}, ${en.aiNotice.items.note}, and ${fill(en.aiNotice.items.level, { band: "HSK 1" })}`,
      action: en.interests.suggest,
    }),
  );
  expect(await accessibilityViolations(page)).toEqual([]);

  await suggest.click();
  const notice = page.getByRole("dialog", { name: en.aiNotice.features.interests.title });
  await expect(notice).toContainText(en.aiNotice.sensitive);
  expect(await accessibilityViolations(page)).toEqual([]);
  await notice.getByRole("button", { name: en.aiNotice.features.interests.confirm }).click();

  const words = interests.getByRole("group", { name: en.interests.words }).getByRole("checkbox");
  await expect(words).toHaveCount(KEPT.length);
  await expect(words.first()).toBeFocused();
  for (const [index, headword] of KEPT.entries()) {
    await expect(words.nth(index)).toHaveAccessibleName(new RegExp(`^${headword}`, "u"));
    await expect(words.nth(index)).toBeChecked();
  }
  await expect(interests).toContainText(dropped(DROPPED));
  await expect(interests).toContainText(fill(en.aiNotice.badge, { model: MODEL }));
  // The themes, the note and the level: exactly the recorded request.
  expect(
    sent
      .filter(({ url }) => url.endsWith("/chat/completions"))
      .map(({ body }) => Body.parse(body).messages),
  ).toEqual([recordedMessages]);
  expect(await accessibilityViolations(page)).toEqual([]);

  const filed = KEPT.slice(0, -1);
  await words.last().uncheck();
  await interests
    .getByRole("button", { name: fill(en.interests.add_other, { count: filed.length }) })
    .click();
  await expect(interests.getByRole("status")).toHaveText(
    fill(en.interests.added_other, { count: filed.length, deck: en.decks.myWords }),
  );
  await expect(words).toHaveCount(1);

  await page.getByRole("link", { name: en.nav.learn }).click();
  await expect(deck(page, en.decks.myWords).getByRole("definition")).toHaveText([
    String(filed.length * 2),
    "0",
    "0",
  ]);
  await page.getByRole("link", { name: en.nav.today }).click();
  await main.getByRole("link", { name: en.today.start }).click();
  await expect(page.locator(":focus")).toContainText(new RegExp(filed.join("|"), "u"));
});
