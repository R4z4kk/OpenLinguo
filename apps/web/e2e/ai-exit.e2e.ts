import { AI_BASE_URLS } from "@openlinguo/core";
import { expect, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import { en } from "../src/i18n/en.ts";
import { fr } from "../src/i18n/fr.ts";
import { accessibilityViolations } from "./accessibility.ts";
import {
  answerItems,
  recorded,
  recording,
  replay,
  rewriteItems,
  type AnswerItem,
  type Exchange,
} from "./ai-replay.ts";
import { test } from "./app.ts";
import { fill, SENTENCES, storedRows } from "./challenge-seed.ts";

/** M5 exit (#190): the providers the other AI tests leave out, and answers that must be refused. */

/** OpenRouter: the model list and the connection test, then the challenge corrected. */
const CONNECTION = recording(new URL("fixtures/ai/openrouter-connection.json", import.meta.url));
const CORRECTION = recorded(new URL("fixtures/ai/openrouter-correction.json", import.meta.url));
const OPENROUTER_MODEL = CONNECTION.model ?? "";
/** Mistral refuses a wrong key with the same 401 on /models and /chat/completions (checked 2026-10-20). */
const MISTRAL_REFUSED =
  recorded(
    new URL(
      "../../../packages/core/src/testing/ai-responses/mistral/unauthorized.json",
      import.meta.url,
    ),
  )[0] ?? null;
const NOT_STRUCTURED = [
  "minimax/minimax-m3.1-flash:free",
  "moondream/moondream3-preview",
  "moondream/moondream3.1-9b-a2b",
];
const KEY = "e2e-key-for-openrouter";
const WORD = "一路平安";

/** The recorded correction, its answer items rewritten. */
const rewritten = (
  rewrite: (items: readonly AnswerItem[]) => readonly AnswerItem[],
): readonly Exchange[] =>
  CORRECTION.map((exchange) =>
    exchange.request.path === "/chat/completions"
      ? {
          ...exchange,
          response: { ...exchange.response, body: rewriteItems(exchange.response.body, rewrite) },
        }
      : exchange,
  );

const chatReply = (body: unknown): readonly Exchange[] => [
  {
    request: { method: "POST", path: "/chat/completions", body: null },
    response: { status: 200, body },
  },
];
/** A 200 whose content is not JSON. */
const NOT_JSON = chatReply({
  object: "chat.completion",
  model: OPENROUTER_MODEL,
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Bon voyage ! Faites un bon voyage." },
      finish_reason: "stop",
    },
  ],
});
/** OpenRouter's documented error inside a 200: only an `error` object, no `choices`. */
const ERROR_IN_200 = chatReply({
  error: {
    code: 502,
    message: "Provider returned error",
    metadata: { provider_name: "AtlasCloud" },
  },
});

/** Writes one row in an IndexedDB store of the app. */
const put = (page: Page, store: string, row: unknown): Promise<void> =>
  page.evaluate(
    ({ store, row }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const transaction = open.result.transaction(store, "readwrite");
          transaction.objectStore(store).put(row);
          transaction.onerror = () => {
            reject(new Error(String(transaction.error)));
          };
          transaction.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    { store, row },
  );

const dayOf = (date: Date): string =>
  [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");

/** Activated with the keyboard: Profile sections still loading above would move a click. */
const press = async (page: Page, target: Locator): Promise<void> => {
  await target.focus();
  await page.keyboard.press("Enter");
};

// Requests from a page a service worker controls escape `page.route` in WebKit.
test.use({ serviceWorkers: "block" });

test("sets up OpenRouter, then refuses a correction whose index names another sentence, then places one out of order", async ({
  page,
}) => {
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  await page.clock.setFixedTime(noon);
  let answers: readonly Exchange[] = CONNECTION.exchanges;
  const sent = await replay(page, AI_BASE_URLS.openrouter, () => answers);
  const openrouter = en.ai.providers.openrouter;
  const provider = en.aiNotice.providers.openrouter;

  await page.goto("/profile");
  const section = page.getByRole("region", { name: en.ai.title });
  await expect(section.getByRole("radio")).toHaveCount(4, { timeout: 90_000 });
  await section.getByRole("radio", { name: openrouter.name }).focus();
  await page.keyboard.press("Space");
  const notice = section.getByRole("note", { name: openrouter.about });
  await expect(notice).toContainText(openrouter.data);
  await expect(notice.getByRole("link", { name: openrouter.training })).toBeVisible();
  await section.getByLabel(en.ai.key).fill(KEY);

  // The list keeps the models with structured answers only, after the one AI notice.
  const testButton = section.getByRole("button", { name: en.ai.test });
  await press(page, testButton);
  await expect(
    page.getByRole("dialog", { name: en.aiNotice.title }).getByRole("button", {
      name: en.aiNotice.confirm,
    }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  const status = section.getByRole("status");
  await expect(status).toHaveText(fill(en.ai.listed_other, { count: 4, provider }));
  const model = section.getByRole("combobox", { name: en.ai.model });
  await expect(model).toBeFocused();
  const options = await model.locator("option").allTextContents();
  expect(options).toContain(OPENROUTER_MODEL);
  for (const id of NOT_STRUCTURED) expect(options).not.toContain(id);
  await model.selectOption(OPENROUTER_MODEL);
  await press(page, testButton);
  await expect(status).toHaveText(fill(en.ai.connected, { model: OPENROUTER_MODEL }));
  expect(await accessibilityViolations(page)).toEqual([]);
  const tested = sent.filter(({ url }) => url.endsWith("/chat/completions"));
  expect(tested).toHaveLength(1);
  expect(tested[0]?.authorization).toBe(`Bearer ${KEY}`);
  expect(tested[0]?.body).toMatchObject({
    model: OPENROUTER_MODEL,
    provider: { require_parameters: true },
  });

  // Today's challenge: sentence 1's answer says it is sentence 3's, and the other way round (#206).
  answers = rewritten((items) =>
    items.map((item) => ({
      ...item,
      index: item.index === 1 ? 3 : item.index === 3 ? 1 : item.index,
    })),
  );
  await page.evaluate(() => {
    localStorage.setItem("openlinguo.newCardsPerDay", "0");
  });
  await put(page, "challenges", {
    day: dayOf(noon),
    headword: "电话",
    readingKey: "dian4 hua4",
    sentences: SENTENCES,
    corrections: SENTENCES.map(() => null),
    updatedAt: 1,
  });
  await page.goto("/review");
  const main = page.getByRole("main");
  await expect(page.locator(":focus")).toContainText(en.challenge.title, { timeout: 90_000 });
  // Seen in the settings, the notice does not show again before the first correction.
  await press(page, main.getByRole("button", { name: en.correction.correct, exact: true }));
  await expect(main.getByRole("button", { name: en.correction.retry })).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(main.getByRole("alert")).toContainText(en.correction.unreadable);
  await expect(main.getByRole("heading", { name: en.correction.title })).toHaveCount(0);
  const [row] = z
    .array(z.object({ corrections: z.array(z.unknown()) }))
    .parse(await storedRows(page, "challenges"));
  expect(row?.corrections).toEqual([null, null, null, null, null]);
  expect(await accessibilityViolations(page)).toEqual([]);

  // Retried, the answers come back in reverse order: each goes to the sentence its index names.
  answers = rewritten((items) => [...items].reverse());
  await page.keyboard.press("Enter");
  await expect(main.getByRole("heading", { level: 2, name: en.correction.title })).toBeVisible();
  const items = answerItems(CORRECTION.at(-1)?.response.body ?? null);
  const [corrected] = z
    .array(z.object({ corrections: z.array(z.unknown()) }))
    .parse(await storedRows(page, "challenges"));
  expect(corrected?.corrections).toMatchObject(
    SENTENCES.map((original, at) => ({
      original,
      corrected: items.find(({ index }) => index === at + 1)?.corrected ?? null,
      provenance: {
        provider: "openrouter",
        model: OPENROUTER_MODEL,
        promptVersion: "zh-correct-v2",
      },
    })),
  );
  expect(await accessibilityViolations(page)).toEqual([]);
  expect(sent.filter(({ url }) => url.endsWith("/chat/completions"))).toHaveLength(3);
});

test("names Mistral's refusal of a key, with its training opt-out", async ({ page }) => {
  if (MISTRAL_REFUSED === null) throw new Error("empty Mistral recording");
  const sent = await replay(page, AI_BASE_URLS.mistral, () => [
    { request: { method: "GET", path: "/models" }, response: MISTRAL_REFUSED.response },
  ]);
  const mistral = en.ai.providers.mistral;
  await page.goto("/profile");
  const section = page.getByRole("region", { name: en.ai.title });
  await expect(section.getByRole("radio")).toHaveCount(4, { timeout: 90_000 });
  await section.getByRole("radio", { name: mistral.name }).focus();
  await page.keyboard.press("Space");
  const notice = section.getByRole("note", { name: mistral.about });
  await expect(notice).toContainText(mistral.data);
  await expect(notice.getByRole("link", { name: mistral.training })).toBeVisible();

  await section.getByLabel(en.ai.key).fill(KEY);
  const testButton = section.getByRole("button", { name: en.ai.test });
  await press(page, testButton);
  await page
    .getByRole("dialog", { name: en.aiNotice.title })
    .getByRole("button", { name: en.aiNotice.confirm })
    .click();
  const alert = section.getByRole("alert");
  await expect(alert).toContainText(
    fill(en.ai.errors.auth, { provider: en.aiNotice.providers.mistral }),
  );
  await expect(alert).toContainText("Invalid API Key");
  await expect(testButton).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);
  expect(sent.map(({ url, authorization }) => [url, authorization])).toEqual([
    [`${AI_BASE_URLS.mistral}/models`, `Bearer ${KEY}`],
  ]);
});

test("refuses an answer that is not JSON and an error inside a 200, and stores nothing", async ({
  page,
}) => {
  let answers: readonly Exchange[] = NOT_JSON;
  const sent = await replay(page, AI_BASE_URLS.openrouter, () => answers);
  // A French gloss is offered in the French interface only.
  await page.addInitScript(() => {
    localStorage.setItem("openlinguo.language", "fr");
  });
  const main = page.getByRole("main");
  const translate = main.getByRole("button", { name: fr.translate.action });
  const provider = fr.aiNotice.providers.openrouter;

  await page.goto(`/learn/dictionary/${WORD}`);
  await expect(main.getByRole("checkbox", { name: fr.decks.myWords })).toBeEnabled({
    timeout: 90_000,
  });
  await expect(translate).toHaveCount(0);
  await put(page, "aiSettings", {
    id: "ai",
    provider: "openrouter",
    localAddress: "http://localhost:11434",
    rememberKey: true,
    key: { provider: "openrouter", value: KEY },
    model: { provider: "openrouter", id: OPENROUTER_MODEL, mode: "json_schema" },
  });
  await page.reload();
  await expect(translate).toBeVisible({ timeout: 90_000 });
  await press(page, translate);
  await expect(
    page
      .getByRole("dialog", { name: fr.aiNotice.title })
      .getByRole("button", { name: fr.aiNotice.confirm }),
  ).toBeFocused();
  await page.keyboard.press("Enter");

  const alert = main.getByRole("alert");
  const retry = main.getByRole("button", { name: fr.translate.retry });
  await expect(alert).toContainText(fr.ai.errors["invalid-response"]);
  await expect(retry).toBeVisible();
  expect(await storedRows(page, "aiGlosses")).toEqual([]);
  expect(await accessibilityViolations(page)).toEqual([]);

  // A 5xx, here inside a 200, is tried twice more, after 2 s then 8 s (ADR 0012).
  answers = ERROR_IN_200;
  await press(page, retry);
  await expect(alert).toContainText(fill(fr.ai.errors.server, { provider }), { timeout: 20_000 });
  await expect(alert).toContainText("Provider returned error");
  expect(sent).toHaveLength(4);
  expect(await storedRows(page, "aiGlosses")).toEqual([]);

  await page.reload();
  await expect(translate).toBeVisible({ timeout: 90_000 });
  await expect(main.getByRole("heading", { name: fr.translate.heading })).toHaveCount(0);
  expect(await storedRows(page, "aiGlosses")).toEqual([]);
});
