import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { recorded, replay } from "./ai-replay.ts";
import { test } from "./app.ts";

/** Real answers of Ollama 0.35.1 with qwen3:30b-a3b: these sentences corrected, and another schema. */
const CORRECTED = recorded(new URL("fixtures/ai/local-correction.json", import.meta.url));
const OFF_SCHEMA = recorded(
  new URL(
    "../../../packages/core/src/testing/ai-responses/local/schema-violation.json",
    import.meta.url,
  ),
);
const LOCAL_SERVER = "http://localhost:11434/v1";
const MODEL = "qwen3:30b-a3b";
const SENTENCES = [
  "我给妈妈打电话。",
  "你的电话号码是多少？",
  "我电话很新。",
  "晚上我不想接电话。",
  "请你电话我。",
];

const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replaceAll(/\{\{(\w+)\}\}/gu, (_, name: string) => String(values[name]));

/** The local server set up, and today's challenge saved, as the app stores them. */
const seed = (page: Page): Promise<void> =>
  page.evaluate(
    ({ sentences, model }) =>
      new Promise<void>((resolve, reject) => {
        const now = new Date();
        const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
          .map((part) => String(part).padStart(2, "0"))
          .join("-");
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const transaction = open.result.transaction(["aiSettings", "challenges"], "readwrite");
          transaction.objectStore("aiSettings").put({
            id: "ai",
            provider: "local",
            localAddress: "http://localhost:11434",
            rememberKey: true,
            key: null,
            model: { provider: "local", id: model, mode: "json_schema" },
          });
          transaction.objectStore("challenges").put({
            day,
            headword: "电话",
            readingKey: "dian4 hua4",
            sentences,
            corrections: sentences.map(() => null),
            updatedAt: 1,
          });
          transaction.onerror = () => {
            reject(new Error(String(transaction.error)));
          };
          transaction.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    { sentences: SENTENCES, model: MODEL },
  );

const storedCorrections = async (page: Page): Promise<readonly unknown[]> => {
  const rows = await page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const request = open.result.transaction("challenges").objectStore("challenges").getAll();
          request.onerror = () => {
            reject(new Error(String(request.error)));
          };
          request.onsuccess = () => {
            open.result.close();
            resolve(request.result);
          };
        };
      }),
  );
  const [row] = z.array(z.object({ corrections: z.array(z.unknown()) })).parse(rows);
  return row?.corrections ?? [];
};

// Requests from a page a service worker controls escape `page.route` in WebKit.
test.use({ serviceWorkers: "block" });

test("corrects the challenge with the keyboard: cancelled, then unreadable, then the diff", async ({
  page,
}) => {
  const main = page.getByRole("main");
  const focused = page.locator(":focus");
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  await page.clock.setFixedTime(noon);
  let answer: "held" | "off-schema" | "corrected" = "held";
  let release: () => void = () => null;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent = await replay(page, LOCAL_SERVER, async () => {
    if (answer === "held") {
      await held;
      return null;
    }
    return answer === "off-schema" ? OFF_SCHEMA : CORRECTED;
  });
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("openlinguo.newCardsPerDay", "0");
  });
  await seed(page);

  // An empty session still ends with today's challenge.
  await page.goto("/review");
  await expect(focused).toContainText(en.challenge.title, { timeout: 90_000 });
  const correct = main.getByRole("button", { name: en.correction.correct, exact: true });
  await expect(correct).toHaveAccessibleDescription(/your 5 sentences/u);
  expect(await accessibilityViolations(page)).toEqual([]);

  await correct.focus();
  await page.keyboard.press("Enter");
  const confirm = page
    .getByRole("dialog")
    .getByRole("button", { name: en.aiNotice.features.challenge.confirm });
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Enter");

  // In progress: read-only fields, « Cancel » aborts and nothing is stored.
  const cancel = main.getByRole("button", { name: en.correction.cancel });
  await expect(cancel).toBeFocused();
  await expect(main.getByRole("button", { name: en.correction.running })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(main.getByRole("combobox", { name: "Sentence 1" })).not.toBeEditable();
  await expect(
    main.getByRole("status").filter({
      hasText: fill(en.correction.runningStatus_other, {
        provider: en.aiNotice.providers.local,
        count: 5,
      }),
    }),
  ).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Enter");
  release();
  await expect(correct).toBeFocused();
  await expect(main.getByRole("combobox", { name: "Sentence 1" })).toBeEditable();

  // An answer to another schema: an error in words, « Retry », nothing stored.
  answer = "off-schema";
  await page.keyboard.press("Enter");
  const retry = main.getByRole("button", { name: en.correction.retry });
  await expect(retry).toBeFocused();
  const alert = main.getByRole("alert");
  await expect(alert).toContainText(en.correction.unreadable);
  await expect(alert).toContainText(en.correction.intact);
  expect(await accessibilityViolations(page)).toEqual([]);
  expect(await storedCorrections(page)).toEqual([null, null, null, null, null]);

  answer = "corrected";
  await page.keyboard.press("Enter");
  await expect(main.getByRole("heading", { level: 2, name: en.correction.title })).toBeVisible();
  await expect(main).toContainText(fill(en.aiNotice.badge, { model: MODEL }));
  await expect(main).toContainText("2 sentences to review, 3 unchanged.");
  await expect(
    main.getByRole("listitem").filter({ hasText: "Sentence 1 · unchanged" }),
  ).toBeVisible();
  const third = main.getByRole("region", { name: "Sentence 3" });
  await expect(third.getByRole("button", { name: en.correction.accept })).toBeFocused();
  await expect(third.locator("p ins")).toHaveText("[added: 的]");
  const fifth = main.getByRole("region", { name: "Sentence 5" });
  await expect(fifth.locator("p ins")).toHaveText(["[added: 打]", "[added: 给]"]);
  expect(await accessibilityViolations(page)).toEqual([]);
  expect(sent).toHaveLength(3);
  expect(sent[2]?.body).toMatchObject({
    model: MODEL,
    messages: [
      { role: "system" },
      { content: JSON.stringify({ word: "电话", sentences: SENTENCES }) },
    ],
  });

  await page.keyboard.press("Enter");
  await expect(third.getByRole("button", { name: en.correction.accept })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const keep = fifth.getByRole("button", { name: en.correction.keep });
  await keep.focus();
  await page.keyboard.press("Enter");
  await expect(keep).toHaveAttribute("aria-pressed", "true");
  const corrections = await storedCorrections(page);
  expect(corrections[2]).toMatchObject({
    original: "我电话很新。",
    corrected: "我的电话很新。",
    choice: "accepted",
    provenance: { origin: "ai", provider: "local", model: MODEL, promptVersion: "zh-correct-v1" },
  });
  expect(corrections[4]).toMatchObject({ corrected: "请你打电话给我。", choice: "kept" });
  expect(corrections[0]).toMatchObject({ corrected: SENTENCES[0], choice: null });

  // Opened again, in the dark theme: the correction and the choices, then the end of the session.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(focused).toContainText(en.correction.title, { timeout: 90_000 });
  await expect(keep).toHaveAttribute("aria-pressed", "true");
  expect(await accessibilityViolations(page)).toEqual([]);
  await main.getByRole("button", { name: en.challenge.finish }).focus();
  await page.keyboard.press("Enter");
  await expect(focused).toContainText(en.review.empty);
});
