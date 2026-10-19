import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { recorded, replay } from "./ai-replay.ts";
import { test } from "./app.ts";

/** Real answer of Ollama 0.35.1 with qwen3:30b-a3b for these five sentences (sent with a word). */
const CORRECTED = recorded(new URL("fixtures/ai/local-correction.json", import.meta.url));
const LOCAL_SERVER = "http://localhost:11434/v1";
const MODEL = "qwen3:30b-a3b";
const SENTENCES = [
  "我给妈妈打电话。",
  "你的电话号码是多少？",
  "我电话很新。",
  "晚上我不想接电话。",
  "请你电话我。",
];
const YESTERDAY = "2026-10-18";
const TODAY = "2026-10-19";

const Entry = z.object({
  day: z.string(),
  text: z.string(),
  corrections: z.array(z.object({ choice: z.string().nullable() }).nullable()),
});

const storedEntries = async (page: Page): Promise<readonly z.output<typeof Entry>[]> =>
  z.array(Entry).parse(
    await page.evaluate(
      () =>
        new Promise<unknown>((resolve, reject) => {
          const open = indexedDB.open("openlinguo");
          open.onerror = () => {
            reject(new Error(String(open.error)));
          };
          open.onsuccess = () => {
            const request = open.result.transaction("journal").objectStore("journal").getAll();
            request.onerror = () => {
              reject(new Error(String(request.error)));
            };
            request.onsuccess = () => {
              open.result.close();
              resolve(request.result);
            };
          };
        }),
    ),
  );

/** The local server set up, and yesterday's entry written, as the app stores them. */
const seed = (page: Page): Promise<void> =>
  page.evaluate(
    ({ text, sentences, day, model }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const transaction = open.result.transaction(["aiSettings", "journal"], "readwrite");
          transaction.objectStore("aiSettings").put({
            id: "ai",
            provider: "local",
            localAddress: "http://localhost:11434",
            rememberKey: true,
            key: null,
            model: { provider: "local", id: model, mode: "json_schema" },
          });
          transaction.objectStore("journal").put({
            day,
            text,
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
    { text: SENTENCES.join(""), sentences: SENTENCES, day: YESTERDAY, model: MODEL },
  );

const noon = (day: string): Date => new Date(`${day}T12:00:00`);

test("writes today's entry without a provider, then reads it among the earlier ones", async ({
  page,
}) => {
  const main = page.getByRole("main");
  await page.clock.setFixedTime(noon(YESTERDAY));
  await page.goto("/learn/journal");
  const entry = main.getByRole("textbox", { name: "Entry of October 18, 2026" });
  await expect(entry).toBeVisible({ timeout: 90_000 });
  await expect(entry).toHaveAccessibleDescription(en.journal.sensitive);
  await expect(main.getByText(en.journal.noPast)).toBeVisible();
  await expect(main.getByRole("link", { name: en.journal.providerLink })).toBeVisible();
  await expect(main.getByRole("button", { name: en.correction.correct })).toHaveCount(0);
  expect(await accessibilityViolations(page)).toEqual([]);

  await entry.focus();
  await page.keyboard.type("我很累。");
  await page.keyboard.press("Enter");
  await page.keyboard.type("我想睡觉");
  await page.keyboard.press("Tab");
  const save = main.getByRole("button", { name: en.journal.save });
  await expect(save).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(main.getByRole("status").filter({ hasText: en.journal.saved })).toBeVisible();
  expect(await storedEntries(page)).toEqual([
    { day: YESTERDAY, text: "我很累。\n我想睡觉", corrections: [null, null] },
  ]);

  // The next learning day: a new empty entry, yesterday's listed and read-only.
  await page.clock.setFixedTime(noon(TODAY));
  await page.reload();
  await expect(main.getByRole("textbox", { name: "Entry of October 19, 2026" })).toHaveValue("", {
    timeout: 90_000,
  });
  const past = main.getByRole("listitem").getByRole("link");
  await expect(past).toHaveCount(1);
  await expect(past).toContainText("October 18, 2026");
  await expect(past).toContainText("我很累。");
  await expect(past).toContainText(en.journal.uncorrected);
  expect(await accessibilityViolations(page)).toEqual([]);
  await past.focus();
  await page.keyboard.press("Enter");
  await expect(
    main.getByRole("heading", { level: 1, name: "Entry of October 18, 2026" }),
  ).toBeVisible();
  await expect(main.getByText("我很累。 我想睡觉")).toBeVisible();
  await expect(main.getByRole("textbox")).toHaveCount(0);
  expect(await accessibilityViolations(page)).toEqual([]);
});

// Requests from a page a service worker controls escape `page.route` in WebKit.
test.use({ serviceWorkers: "block" });

test("corrects an earlier entry, then today's, with the keyboard in the dark theme", async ({
  page,
}) => {
  const main = page.getByRole("main");
  const focused = page.locator(":focus");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.clock.setFixedTime(noon(TODAY));
  const sent = await replay(page, LOCAL_SERVER, () => CORRECTED);
  await page.goto("/");
  await seed(page);

  await page.goto("/learn/journal");
  const past = main.getByRole("listitem").getByRole("link");
  await expect(past).toContainText(en.journal.uncorrected, { timeout: 90_000 });
  await past.focus();
  await page.keyboard.press("Enter");

  const correct = main.getByRole("button", { name: en.correction.correct, exact: true });
  await expect(correct).toHaveAccessibleDescription(/the text of this entry/u);
  expect(await accessibilityViolations(page)).toEqual([]);
  await correct.focus();
  await page.keyboard.press("Enter");
  const notice = page.getByRole("dialog");
  await expect(notice).toContainText(en.aiNotice.sensitive);
  await expect(
    notice.getByRole("button", { name: en.aiNotice.features.journal.confirm }),
  ).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(main.getByRole("heading", { level: 2, name: en.correction.title })).toBeVisible();
  await expect(main).toContainText("2 sentences to review, 3 unchanged.");
  const third = main.getByRole("region", { name: "Sentence 3" });
  await expect(third.getByRole("button", { name: en.correction.accept })).toBeFocused();
  await expect(correct).toHaveCount(0);
  expect(await accessibilityViolations(page)).toEqual([]);
  expect(sent).toHaveLength(1);
  expect(sent[0]?.body).toMatchObject({
    model: MODEL,
    messages: [
      { role: "system" },
      { content: JSON.stringify({ word: null, sentences: SENTENCES }) },
    ],
  });
  await page.keyboard.press("Enter");
  await expect(third.getByRole("button", { name: en.correction.accept })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const [yesterday] = await storedEntries(page);
  expect(yesterday?.corrections.map((correction) => correction?.choice ?? null)).toEqual([
    null,
    null,
    "accepted",
    null,
    null,
  ]);

  // Back to the journal: yesterday's entry corrected, today's sent on its own, without the notice.
  await main.getByRole("link", { name: en.journal.back }).focus();
  await page.keyboard.press("Enter");
  await expect(past).toContainText(en.journal.corrected);
  const entry = main.getByRole("textbox", { name: "Entry of October 19, 2026" });
  await entry.focus();
  await page.keyboard.type(SENTENCES.join(""));
  await page.keyboard.press("Tab");
  await expect(focused).toHaveText(en.correction.correct);
  await page.keyboard.press("Enter");
  await expect(main.getByRole("heading", { level: 3, name: en.correction.title })).toBeVisible();
  await expect(third.getByRole("button", { name: en.correction.accept })).toBeFocused();
  expect(sent).toHaveLength(2);
  expect(await accessibilityViolations(page)).toEqual([]);
  expect(
    (await storedEntries(page)).map(({ day, corrections }) => [day, corrections.length]),
  ).toEqual([
    [YESTERDAY, 5],
    [TODAY, 5],
  ]);
});
