import { AI_BASE_URLS } from "@openlinguo/core";
import { expect, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { recorded, replay } from "./ai-replay.ts";
import { test } from "./app.ts";

/** Real answers: Ollama 0.35.1 with qwen3:30b-a3b, and Groq refusing a wrong key. */
const LOCAL = recorded(new URL("fixtures/ai/local-connection-test.json", import.meta.url));
const GROQ_REFUSED =
  recorded(
    new URL(
      "../../../packages/core/src/testing/ai-responses/groq/unauthorized.json",
      import.meta.url,
    ),
  )[0] ?? null;
const LOCAL_SERVER = "http://localhost:11434/v1";
const KEY = "gsk_e2e-key-for-groq-only";

const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replaceAll(/\{\{(\w+)\}\}/gu, (_, name: string) => String(values[name]));

const storedRows = (page: Page): Promise<unknown> =>
  page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const request = open.result.transaction("aiSettings").objectStore("aiSettings").getAll();
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

// Requests from a page a service worker controls escape `page.route` in WebKit.
test.use({ serviceWorkers: "block" });

test("sets up Groq: its notice, a key kept in memory only, a refused key named", async ({
  page,
}) => {
  if (GROQ_REFUSED === null) throw new Error("empty Groq recording");
  // Groq refuses a wrong key with the same 401 on every path (ADR 0012).
  const sent = await replay(page, AI_BASE_URLS.groq, () => [
    { request: { method: "GET", path: "/models" }, response: GROQ_REFUSED.response },
  ]);
  const groq = en.ai.providers.groq;
  await page.goto("/profile");
  const section = page.getByRole("region", { name: en.ai.title });
  await expect(section.getByRole("radio")).toHaveCount(4, { timeout: 90_000 });
  await expect(section.getByRole("radio", { checked: true })).toHaveCount(0);

  await section.getByRole("radio", { name: groq.name }).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await expect(section.getByRole("button", { name: en.ai.changeLabel })).toBeVisible();
  await expect(section.getByRole("radio")).toHaveCount(0);
  const notice = section.getByRole("note", { name: groq.about });
  await expect(notice).toContainText(fill(en.ai.notice, { provider: groq.name }));
  await expect(notice.getByRole("link", { name: groq.privacy })).toHaveAttribute(
    "href",
    "https://groq.com/privacy-policy",
  );
  expect(await accessibilityViolations(page)).toEqual([]);

  await section.getByRole("switch", { name: en.ai.dontRemember }).click();
  await section.getByLabel(en.ai.key).fill(KEY);
  const testButton = section.getByRole("button", { name: en.ai.test });
  await testButton.click();
  await expect(section.getByRole("alert")).toContainText(
    fill(en.ai.errors.auth, { provider: en.aiNotice.providers.groq }),
  );
  await expect(section.getByRole("alert")).toContainText("Invalid API Key");
  await expect(testButton).toBeFocused();
  expect(sent).toEqual([
    { url: `${AI_BASE_URLS.groq}/models`, authorization: `Bearer ${KEY}`, body: null },
  ]);
  expect(await accessibilityViolations(page)).toEqual([]);
  expect(JSON.stringify(await storedRows(page))).not.toContain(KEY);

  await page.reload();
  await expect(section.getByRole("button", { name: en.ai.changeLabel })).toBeVisible({
    timeout: 90_000,
  });
  await expect(section.getByLabel(en.ai.key)).toHaveValue("");
  await expect(section.getByRole("switch", { name: en.ai.dontRemember })).toBeChecked();
});

test("connects to a local server: the how-to, a refused origin, then the test sentence", async ({
  page,
}) => {
  let running = false;
  const sent = await replay(page, LOCAL_SERVER, () => (running ? LOCAL : null));
  const local = en.ai.providers.local;
  await page.goto("/profile");
  const section = page.getByRole("region", { name: en.ai.title });
  await section.getByText(local.name, { exact: true }).click({ timeout: 90_000 });
  await section.getByLabel(en.ai.address).click();
  await expect(section.getByRole("button", { name: en.ai.changeLabel })).toBeVisible();
  await expect(section.getByLabel(en.ai.key)).toHaveCount(0);
  const origin = new URL(page.url()).origin;
  await expect(section.getByText(`OLLAMA_ORIGINS=${origin} ollama serve`)).toBeVisible();

  const testButton = section.getByRole("button", { name: en.ai.test });
  await testButton.click();
  const alert = section.getByRole("alert");
  await expect(alert).toContainText(en.ai.errors.localNetwork);
  await expect(alert).toContainText(fill(en.ai.errors.localNetworkHelp, { origin }));
  await expect(testButton).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);

  running = true;
  await testButton.click();
  const status = section.getByRole("status");
  await expect(status).toHaveText(
    fill(en.ai.listed_other, { count: 3, provider: en.aiNotice.providers.local }),
  );
  const model = section.getByRole("combobox", { name: en.ai.model });
  await expect(model).toBeFocused();
  await model.selectOption("qwen3:30b-a3b");
  await testButton.click();
  await expect(status).toHaveText(fill(en.ai.connected, { model: "qwen3:30b-a3b" }));
  await expect(model).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);
  expect(sent.map(({ url }) => url.slice(LOCAL_SERVER.length))).toEqual([
    "/models",
    "/models",
    "/models",
    "/chat/completions",
  ]);
  expect(sent.every(({ authorization }) => authorization === null)).toBe(true);

  await page.reload();
  await expect(section.getByText(local.name, { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(model).toBeDisabled();
  await expect(model).toHaveValue("qwen3:30b-a3b");
  await expect(section.getByText(en.ai.howTo)).toBeVisible();
  await expect(section.getByText(en.ai.howToStart)).toBeHidden();
});

test("changes the provider with the mouse", async ({ page }) => {
  const main = page.getByRole("main");
  const section = page.getByRole("region", { name: en.ai.title });
  const groq = en.ai.providers.groq;
  const openrouter = en.ai.providers.openrouter;
  await page.goto("/profile");
  await expect(section.getByRole("radio")).toHaveCount(4, { timeout: 90_000 });
  // The sections above stop moving the page once filled.
  await expect(main.getByText(en.progress.longestStreak)).toBeVisible();
  await expect(main.getByText(en.stats.words)).toBeVisible();

  await section.getByText(groq.name, { exact: true }).click();
  await section.getByLabel(en.ai.key).fill(KEY);
  await section.getByRole("button", { name: en.ai.changeLabel }).click();
  await expect(section.getByRole("radio", { name: groq.name })).toBeFocused();
  await section.getByText(openrouter.name, { exact: true }).click();
  await expect(section.getByRole("note", { name: openrouter.about })).toBeVisible();
  await expect(section.getByRole("radio")).toHaveCount(0);
  await expect(section.getByLabel(en.ai.key)).toHaveValue("");

  await section.getByRole("button", { name: en.ai.changeLabel }).click();
  await section.getByText(groq.name, { exact: true }).click();
  await expect(section.getByRole("note", { name: groq.about })).toBeVisible();
  await expect(section.getByLabel(en.ai.key)).toHaveValue(KEY);
});
