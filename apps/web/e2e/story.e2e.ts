import { randomUUID } from "node:crypto";
import { AI_BASE_URLS, CURRENT_SCHEDULER } from "@openlinguo/core";
import { expect, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { recording, replay, type Exchange, type Recording } from "./ai-replay.ts";
import { test } from "./app.ts";
import { startCards } from "./cards.ts";
import { all, put } from "./seed.ts";

/** Groq's recommended model and Ollama's real answers to the story prompt (`record:ai … story`). */
const GROQ = recording(new URL("fixtures/ai/groq-story.json", import.meta.url));
const OLLAMA = recording(new URL("fixtures/ai/local-story.json", import.meta.url));
const KEY = "gsk_e2e-key-for-stories";

/** The words of the recorded request, the most recently reviewed first. */
const WORDS = [
  ["旅游", "lu3 you2"],
  ["照片", "zhao4 pian4"],
  ["礼物", "li3 wu4"],
  ["公园", "gong1 yuan2"],
  ["天气", "tian1 qi4"],
  ["朋友", "peng2 you5"],
] as const;
const SENT_WORDS = WORDS.map(([word]) => word).join("、");
const HOUR = 60 * 60_000;

const Completion = z.looseObject({
  choices: z.array(z.looseObject({ message: z.looseObject({ content: z.string() }) })),
});
const Story = z.object({
  title: z.string(),
  paragraphs: z.array(z.string()),
  names: z.array(z.object({ text: z.string(), kind: z.string() })),
});
type Story = z.output<typeof Story>;

/** The recorded answer exchanges that went through, for the chat call only. */
const answers = ({ exchanges }: Recording): readonly Exchange[] =>
  exchanges.filter(
    ({ request, response }) => request.path === "/chat/completions" && response.status === 200,
  );

const storyOf = (exchange: Exchange): Story => {
  const completion = Completion.parse(exchange.response.body);
  return Story.parse(JSON.parse(completion.choices[0]?.message.content ?? ""));
};

/** The same exchange with another story as the model's answer. */
const answering = (exchange: Exchange, story: object): Exchange => {
  const completion = Completion.parse(exchange.response.body);
  return {
    ...exchange,
    response: {
      ...exchange.response,
      body: {
        ...completion,
        choices: completion.choices.map((choice) => ({
          ...choice,
          message: { ...choice.message, content: JSON.stringify(story) },
        })),
      },
    },
  };
};

const RECORDED = answers(GROQ);
const recorded = RECORDED[0] ?? null;
if (recorded === null) throw new Error("no recorded story answer");
const MODEL = GROQ.model ?? "";
const OLLAMA_MODEL = OLLAMA.model ?? "";

const settingsOf = (provider: "groq" | "local") => ({
  id: "ai",
  provider,
  localAddress: "http://localhost:11434",
  rememberKey: true,
  key: provider === "groq" ? { provider, value: KEY } : null,
  model: { provider, id: provider === "groq" ? MODEL : OLLAMA_MODEL, mode: "json_schema" },
});

const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replaceAll(/\{\{(\w+)\}\}/gu, (_, name: string) => String(values[name]));

const Request = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
  response_format: z.object({ type: z.string() }),
});

const StoredStory = z.object({
  title: z.string(),
  body: z.string(),
  source: z.literal("ai"),
  provenance: z.object({
    origin: z.literal("ai"),
    provider: z.string(),
    model: z.string(),
    promptVersion: z.string(),
    createdAt: z.string(),
  }),
});

const press = async (page: Page, target: Locator, key = "Enter"): Promise<void> => {
  await target.focus();
  await page.keyboard.press(key);
};

/** A learner with six words in their learning steps, the first reviewed last, and a provider. */
const seed = async (page: Page, settings: object | null): Promise<void> => {
  const main = page.getByRole("main");
  await page.goto("/read");
  await expect(main.getByText(en.library.emptyTitle)).toBeVisible({ timeout: 90_000 });
  if (settings !== null) await put(page, "aiSettings", settings);
  for (const [index, [headword, readingKey]] of WORDS.entries()) {
    await startCards(page, { headword, readingKey }, ["recognition"], "learning");
    await put(page, "reviews", {
      id: randomUUID(),
      cardId: JSON.stringify(["zh", headword, readingKey, "recognition"]),
      grade: "good",
      reviewedAt: Date.UTC(2026, 9, 24, 12) - index * HOUR,
      utcOffsetMinutes: 0,
      scheduler: CURRENT_SCHEDULER,
      dailyGoal: 10,
      wordDone: false,
    });
  }
  await page.reload();
};

/** From the library to the form, with the keyboard only. */
const openForm = async (page: Page): Promise<Locator> => {
  const main = page.getByRole("main");
  const write = main.getByRole("link", { name: en.story.write });
  await expect(write).toBeVisible({ timeout: 90_000 });
  await press(page, write);
  await expect(main.getByRole("heading", { level: 1, name: en.story.title })).toBeVisible();
  return main;
};

const confirmNotice = async (page: Page): Promise<void> => {
  const notice = page.getByRole("dialog", { name: en.aiNotice.title });
  await expect(notice).toContainText(
    fill(en.aiNotice.uses.story, { action: en.story.generate, place: en.read.title }),
  );
  expect(await accessibilityViolations(page)).toEqual([]);
  await press(page, notice.getByRole("button", { name: en.aiNotice.confirm }));
  await expect(notice).toHaveCount(0);
};

// Requests from a page a service worker controls escape `page.route` in WebKit.
test.use({ serviceWorkers: "block" });

test("writes a story from the learning steps with Groq, stores it with its provenance and opens it", async ({
  page,
}) => {
  const story = storyOf(recorded);
  let release: () => void = () => null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent = await replay(page, AI_BASE_URLS.groq, async () => {
    await gate;
    return RECORDED;
  });
  await seed(page, settingsOf("groq"));
  const main = await openForm(page);

  // The form shows what will be sent: level, theme, length and the words, the latest first.
  await expect(main.getByText("HSK 1", { exact: true })).toBeVisible();
  await expect(main.getByRole("region", { name: en.story.words }).getByRole("listitem")).toHaveText(
    WORDS.map(([word]) => word),
  );
  await main.getByLabel(en.story.theme).selectOption("travel");
  const medium = main.getByRole("radio", { name: en.story.medium });
  await expect(medium).toBeChecked();
  const generate = main.getByRole("button", { name: en.story.generate });
  await expect(generate).toHaveAccessibleDescription(
    fill(en.aiNotice.sent, {
      provider: en.aiNotice.providers.groq,
      items: [
        fill(en.aiNotice.items.level, { band: "HSK 1" }),
        fill(en.aiNotice.items.storyTheme, { theme: en.interests.theme.travel }),
        `${en.aiNotice.items.storyMedium}, and ${fill(en.aiNotice.items.storyWords_other, { count: 6, words: SENT_WORDS })}`,
      ].join(", "),
      action: en.story.generate,
    }),
  );
  expect(await accessibilityViolations(page)).toEqual([]);

  // The first use asks first; then one press is one call, and a second press while it runs is none.
  await press(page, generate);
  await confirmNotice(page);
  const cancel = main.getByRole("button", { name: en.story.cancel });
  await expect(cancel).toBeFocused();
  await expect(generate).toHaveAttribute("aria-disabled", "true");
  await expect(main.getByRole("status").filter({ hasText: en.story.writing })).toBeVisible();
  await expect.poll(() => sent.length).toBe(1);
  await press(page, generate);
  expect(sent).toHaveLength(1);
  expect(await accessibilityViolations(page)).toEqual([]);
  release();

  // The story opens in the reader, with its badge and its coverage computed on the device.
  await expect(page).toHaveURL(/\/read\/[0-9a-f-]{36}$/u, { timeout: 60_000 });
  await expect(main.getByRole("heading", { level: 1, name: story.title })).toBeVisible();
  await expect(main.getByText(fill(en.aiNotice.badge, { model: MODEL }))).toBeVisible();
  await expect(main.getByText(en.reader.coverageTitle)).toBeVisible({ timeout: 60_000 });
  expect(await accessibilityViolations(page)).toEqual([]);

  expect(sent).toHaveLength(1);
  const [request] = sent;
  expect(request?.url).toBe(`${AI_BASE_URLS.groq}/chat/completions`);
  expect(request?.authorization).toBe(`Bearer ${KEY}`);
  const { messages, response_format: format } = Request.parse(request?.body);
  expect(format.type).toBe("json_schema");
  expect(messages[0]?.content).toContain("about 400 Chinese characters");
  expect(JSON.parse(messages.at(-1)?.content ?? "")).toEqual({
    theme: en.interests.theme.travel,
    words: WORDS.map(([word]) => word),
  });

  const stored = (await all(page, "texts")).map((row) => StoredStory.parse(row));
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    title: story.title,
    body: story.paragraphs.join("\n"),
    source: "ai",
    provenance: { provider: "groq", model: MODEL, promptVersion: "zh-story-v1" },
  });

  // The library lists it, with the badge and its share of known words.
  await press(page, main.getByRole("link", { name: en.reader.back, exact: true }));
  const row = main.getByRole("listitem").filter({ hasText: story.title });
  await expect(row).toContainText(en.library.source.ai);
  await expect(row.getByText(fill(en.aiNotice.badge, { model: MODEL }))).toBeVisible();
  await expect(row).toContainText(/\d+% of words known/u, { timeout: 60_000 });
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("proposes the names of the story in the unknown-words panel", async ({ page }) => {
  const named = answering(recorded, {
    ...storyOf(recorded),
    paragraphs: [...storyOf(recorded).paragraphs, "我们和丁丹妮去学校。"],
    names: [{ text: "丁丹妮", kind: "person" }],
  });
  await replay(page, AI_BASE_URLS.groq, () => [named]);
  await seed(page, settingsOf("groq"));
  const main = await openForm(page);
  await press(page, main.getByRole("button", { name: en.story.generate }));
  await confirmNotice(page);
  await expect(page).toHaveURL(/\/read\/[0-9a-f-]{36}$/u, { timeout: 60_000 });

  const link = main.getByRole("link", { name: /^Unknown words in this text/ });
  await expect(link).toHaveText(/· \d+$/u, { timeout: 60_000 });
  await press(page, link);
  const card = main
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 2, name: "丁丹妮" }) });
  await expect(
    card.getByText(`${en.unknownWords.source.ai} · ${en.unknownWords.kind.person}`),
  ).toBeVisible();
  await expect(card.getByText(fill(en.aiNotice.badge, { model: MODEL }))).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  // Nothing is applied before the learner accepts.
  await press(page, card.getByRole("button", { name: en.unknownWords.accept }));
  await expect(main.getByRole("status").filter({ hasText: "丁丹妮" })).toContainText(
    "丁丹妮 added to your lexicon.",
  );
});

test("says an invalid answer, stores nothing and asks again only when pressed", async ({
  page,
}) => {
  const valid = storyOf(recorded);
  const invalid = answering(recorded, { ...valid, paragraphs: [] });
  const titled = answering(recorded, { ...valid, title: "题".repeat(101) });
  let next: readonly Exchange[] = [invalid];
  const sent = await replay(page, AI_BASE_URLS.groq, () => next);
  await seed(page, settingsOf("groq"));
  const main = await openForm(page);
  const generate = main.getByRole("button", { name: en.story.generate });

  await press(page, generate);
  await confirmNotice(page);
  const alert = main.getByRole("alert");
  await expect(alert).toContainText(en.ai.errors["invalid-response"]);
  const retry = main.getByRole("button", { name: en.story.retry });
  await expect(retry).toBeFocused();
  expect(await all(page, "texts")).toEqual([]);
  expect(await all(page, "resolutions")).toEqual([]);
  expect(sent).toHaveLength(1);
  expect(await accessibilityViolations(page)).toEqual([]);

  // A story the text check refuses is the same error, and nothing is stored either.
  next = [titled];
  await press(page, retry);
  await expect(alert).toContainText("title: more than 100 characters");
  await expect(retry).toBeFocused();
  expect(await all(page, "texts")).toEqual([]);
  expect(sent).toHaveLength(2);

  next = RECORDED;
  await press(page, retry);
  await expect(page).toHaveURL(/\/read\/[0-9a-f-]{36}$/u, { timeout: 60_000 });
  expect(sent).toHaveLength(3);
  expect(await all(page, "texts")).toHaveLength(1);
});

test("writes a short story with a local Ollama server, without a key", async ({ page }) => {
  const sent = await replay(page, AI_BASE_URLS.local, () => answers(OLLAMA));
  await page.addInitScript(() => {
    localStorage.setItem("openlinguo.interests", JSON.stringify({ themes: ["music"], note: "" }));
  });
  await seed(page, settingsOf("local"));
  const main = await openForm(page);
  // The theme starts on the first of the interests ticked in the profile.
  await expect(main.getByLabel(en.story.theme)).toHaveValue("music");
  await expect(main.getByRole("button", { name: en.story.generate })).toHaveAccessibleDescription(
    new RegExp(en.aiNotice.providers.local, "u"),
  );

  // Arrow keys move the choice of the length group.
  await main.getByRole("radio", { name: en.story.medium }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(main.getByRole("radio", { name: en.story.short })).toBeChecked();

  await press(page, main.getByRole("button", { name: en.story.generate }));
  await confirmNotice(page);
  await expect(page).toHaveURL(/\/read\/[0-9a-f-]{36}$/u, { timeout: 60_000 });
  await expect(main.getByText(fill(en.aiNotice.badge, { model: OLLAMA_MODEL }))).toBeVisible();

  expect(sent).toHaveLength(1);
  expect(sent[0]?.url).toBe(`${AI_BASE_URLS.local}/chat/completions`);
  expect(sent[0]?.authorization).toBeNull();
  const { messages } = Request.parse(sent[0]?.body);
  expect(messages[0]?.content).toContain("about 150 Chinese characters");
  const stored = (await all(page, "texts")).map((row) => StoredStory.parse(row));
  expect(stored[0]?.provenance).toMatchObject({
    provider: "local",
    model: OLLAMA_MODEL,
    promptVersion: "zh-story-v1",
  });
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("needs a provider: the entry is disabled and points to the AI settings", async ({ page }) => {
  const sent = await replay(page, AI_BASE_URLS.groq, () => null);
  await seed(page, null);
  const main = page.getByRole("main");
  const write = main.getByRole("button", { name: en.story.write });
  await expect(write).toHaveAttribute("aria-disabled", "true", { timeout: 90_000 });
  await expect(write).toHaveAccessibleDescription(`${en.story.noProvider} ${en.story.toSettings}`);
  const settings = main.getByRole("link", { name: en.story.toSettings });
  await expect(settings).toHaveAttribute("href", "/profile#ai");
  expect(await accessibilityViolations(page)).toEqual([]);

  await press(page, write);
  await expect(page).toHaveURL(/\/read$/u);

  await page.goto("/read/story");
  await expect(main.getByRole("heading", { level: 1, name: en.story.title })).toBeVisible({
    timeout: 90_000,
  });
  await expect(main.getByText(en.story.noProvider)).toBeVisible();
  await expect(main.getByRole("button", { name: en.story.generate })).toHaveCount(0);
  expect(await accessibilityViolations(page)).toEqual([]);
  expect(sent).toHaveLength(0);
});
