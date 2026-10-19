import { readFileSync } from "node:fs";
import { AI_BASE_URLS } from "@openlinguo/core";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { fr } from "../src/i18n/fr.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { recorded, replay, type Exchange } from "./ai-replay.ts";
import { test } from "./app.ts";

/** HSK 2, no French gloss (data/gaps/missing-french.tsv). */
const WORD = "一路平安";
const KEY = "gsk_e2e-key-for-translations";
const CHAT = `${AI_BASE_URLS.groq}/chat/completions`;

const Messages = z.array(z.object({ role: z.string(), content: z.string() }));

/** Groq's real answer to the gloss prompt for 一路平安 (`record:ai groq=<model> gloss`). */
const GLOSS_URL = new URL("fixtures/ai/groq-gloss.json", import.meta.url);
const { model: MODEL, exchanges } = z
  .object({
    model: z.string(),
    exchanges: z.array(
      z.object({
        request: z.object({ body: z.object({ messages: Messages }) }),
        response: z.object({
          body: z.object({
            choices: z.tuple([z.object({ message: z.object({ content: z.string() }) })]),
          }),
        }),
      }),
    ),
  })
  .parse(JSON.parse(readFileSync(GLOSS_URL, "utf8")));
const answered = exchanges.at(-1) ?? null;
if (answered === null) throw new Error("empty gloss recording");
const FRENCH = z
  .object({ glosses: z.array(z.string()) })
  .parse(JSON.parse(answered.response.body.choices[0].message.content)).glosses;
const GLOSS = recorded(GLOSS_URL);
const REFUSED: readonly Exchange[] = recorded(
  new URL(
    "../../../packages/core/src/testing/ai-responses/groq/unauthorized.json",
    import.meta.url,
  ),
);

const SETTINGS = {
  id: "ai",
  provider: "groq",
  localAddress: "http://localhost:11434",
  rememberKey: true,
  key: { provider: "groq", value: KEY },
  model: { provider: "groq", id: MODEL, mode: "json_schema" },
};

const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replaceAll(/\{\{(\w+)\}\}/gu, (_, name: string) => String(values[name]));

/** Reads, or with `row` writes, one IndexedDB store of the app. */
const store = (page: Page, name: string, row: unknown): Promise<unknown> =>
  page.evaluate(
    ({ name, row }) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const transaction = open.result.transaction(name, "readwrite");
          const objects = transaction.objectStore(name);
          if (row !== null) objects.put(row);
          const all = objects.getAll();
          transaction.onerror = () => {
            reject(new Error(String(transaction.error)));
          };
          transaction.oncomplete = () => {
            open.result.close();
            resolve(all.result);
          };
        };
      }),
    { name, row },
  );

const StoredGloss = z.object({
  id: z.string(),
  senses: z.array(z.object({ english: z.string(), french: z.string() })),
  provenance: z.object({ provider: z.string(), model: z.string(), promptVersion: z.string() }),
});

// Requests from a page a service worker controls escape `page.route` in WebKit.
test.use({ serviceWorkers: "block" });

test("translates an entry once, after a refused key, shows it on its card and deletes it", async ({
  page,
}) => {
  let answers: readonly Exchange[] = REFUSED;
  const sent = await replay(page, AI_BASE_URLS.groq, () => answers);
  await page.addInitScript(() => {
    localStorage.setItem("openlinguo.language", "fr");
  });
  const main = page.getByRole("main");
  const myWords = main.getByRole("checkbox", { name: fr.decks.myWords });
  const translate = main.getByRole("button", { name: fr.translate.action });

  // Hidden until a provider, its key and a model are set.
  await page.goto(`/learn/dictionary/${WORD}`);
  await expect(myWords).toBeEnabled({ timeout: 90_000 });
  await expect(translate).toHaveCount(0);
  await store(page, "aiSettings", SETTINGS);
  await page.reload();
  await expect(translate).toBeVisible({ timeout: 90_000 });
  await expect(translate).toHaveAccessibleDescription(
    fill(fr.aiNotice.sent, {
      provider: fr.aiNotice.providers.groq,
      items: "le mot, son pinyin et ses 2 sens anglais",
      action: fr.translate.action,
    }),
  );
  expect(await accessibilityViolations(page)).toEqual([]);

  // The first use asks first; a refused key is said in words, with a retry, and stores nothing.
  await translate.click();
  const notice = page.getByRole("dialog", { name: fr.aiNotice.features.translation.title });
  await notice.getByRole("button", { name: fr.aiNotice.features.translation.confirm }).click();
  await expect(main.getByRole("alert")).toContainText(
    fill(fr.ai.errors.auth, { provider: fr.aiNotice.providers.groq }),
  );
  const retry = main.getByRole("button", { name: fr.translate.retry });
  await expect(retry).toBeVisible();
  expect(await store(page, "aiGlosses", null)).toEqual([]);
  expect(await accessibilityViolations(page)).toEqual([]);

  answers = GLOSS;
  await retry.click();
  const french = main.getByRole("heading", { name: fr.translate.heading });
  await expect(french).toBeFocused();
  await expect(main.getByText(fill(fr.aiNotice.badge, { model: MODEL }))).toBeVisible();
  for (const gloss of FRENCH) await expect(main.getByText(gloss, { exact: true })).toBeVisible();
  await expect(main.getByRole("listitem").filter({ hasText: FRENCH[0] ?? "" })).toContainText(
    "to have a pleasant journey",
  );
  await expect(main.getByRole("alert")).toHaveCount(0);
  await expect(retry).toHaveCount(0);
  expect(sent.map(({ url, authorization }) => [url, authorization])).toEqual([
    [CHAT, `Bearer ${KEY}`],
    [CHAT, `Bearer ${KEY}`],
  ]);
  expect(z.object({ messages: Messages }).parse(sent[1]?.body).messages).toEqual(
    answered.request.body.messages,
  );
  expect(z.array(StoredGloss).parse(await store(page, "aiGlosses", null))).toEqual([
    {
      id: `${WORD}\tyi1 lu4 ping2 an1`,
      senses: [
        { english: "to have a pleasant journey", french: FRENCH[0] },
        { english: "Bon voyage!", french: FRENCH[1] },
      ],
      provenance: { provider: "groq", model: MODEL, promptVersion: "zh-gloss-fr-v1" },
    },
  ]);
  expect(await accessibilityViolations(page)).toEqual([]);

  // Its review card shows the AI gloss with the « IA » mark.
  await myWords.click();
  await expect(myWords).toBeChecked();
  await page.goto("/review");
  await main.getByRole("button", { name: fr.review.showAnswer }).click();
  await expect(main.getByText(fr.translate.markLabel)).toBeAttached();
  await expect(main.getByText(FRENCH[0] ?? "", { exact: false })).toBeVisible();

  // Translated once: back on the word page, then deleted to ask again.
  await page.goto(`/learn/dictionary/${WORD}`);
  const remove = main.getByRole("button", { name: fr.translate.delete });
  await expect(remove).toBeVisible({ timeout: 90_000 });
  await remove.click();
  await expect(translate).toBeFocused();
  await expect(french).toHaveCount(0);
  expect(await store(page, "aiGlosses", null)).toEqual([]);
  expect(sent).toHaveLength(2);
});
