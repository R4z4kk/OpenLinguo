import { AI_BASE_URLS } from "@openlinguo/core";
import { expect } from "@playwright/test";
import { z } from "zod";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { replay, type Exchange } from "./ai-replay.ts";
import { test } from "./app.ts";
import {
  answerOf,
  confirmNotice,
  fill,
  GROQ,
  GROQ_ANSWER,
  GROQ_MODEL,
  KEY,
  OLLAMA,
  OLLAMA_MODEL,
  seed,
  SENT,
  SEQUENCES,
  settingsOf,
} from "./explain-replay.ts";
import { card, openPanel, press, rowsOf } from "./unknown-words-panel.ts";

const Request = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
});
const Explained = z.object({
  sequences: z.array(z.object({ index: z.number(), sequence: z.string(), sentence: z.string() })),
});

// Requests from a page a service worker controls escape `page.route` in WebKit.
test.use({ serviceWorkers: "block" });

test("asks Groq about the unknown sequences in one call and proposes its answers", async ({
  page,
}) => {
  let release: () => void = () => null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent = await replay(page, AI_BASE_URLS.groq, async () => {
    await gate;
    return [GROQ_ANSWER];
  });
  await seed(page, settingsOf("groq"));
  const main = await openPanel(page);
  await expect(main.getByRole("heading", { level: 2 })).toHaveText(SEQUENCES);

  // The line under the button says what the press sends, before the press.
  const ask = main.getByRole("button", { name: en.aiExplain.ask });
  await expect(ask).toHaveAccessibleDescription(
    fill(en.aiNotice.sent, {
      provider: en.aiNotice.providers.groq,
      items: `${fill(en.aiNotice.items.sequences_other, { count: SENT.length, sequences: SENT.join("、") })} and ${en.aiNotice.items.language}`,
      action: en.aiExplain.ask,
    }),
  );
  expect(await accessibilityViolations(page)).toEqual([]);

  // The first use asks first; then one press is one call, and a second press while it runs is none.
  await press(page, ask);
  await confirmNotice(page);
  const cancel = main.getByRole("button", { name: en.aiExplain.cancel });
  await expect(cancel).toBeFocused();
  await expect(main.getByRole("status").filter({ hasText: en.aiExplain.asking })).toBeVisible();
  await expect.poll(() => sent.length).toBe(1);
  await press(page, main.getByRole("button", { name: en.aiExplain.asking }));
  expect(sent).toHaveLength(1);
  expect(await accessibilityViolations(page)).toEqual([]);
  release();

  await expect(
    main
      .getByRole("status")
      .filter({ hasText: fill(en.aiExplain.answered_other, { count: SENT.length }) }),
  ).toBeVisible();
  const asked = main.getByRole("button", { name: en.aiExplain.ask });
  await expect(asked).toBeFocused();
  expect(sent[0]?.url).toBe(`${AI_BASE_URLS.groq}/chat/completions`);
  expect(sent[0]?.authorization).toBe(`Bearer ${KEY}`);
  const { messages } = Request.parse(sent[0]?.body);
  const { sequences } = Explained.parse(JSON.parse(messages.at(-1)?.content ?? ""));
  expect(sequences.map(({ sequence }) => sequence)).toEqual(SENT);
  expect(sequences.slice(0, SEQUENCES.length)).toEqual([
    { index: 1, sequence: "王芳", sentence: "我的同学王芳和老师去张家界玩了。" },
    { index: 2, sequence: "袁家界拍", sentence: "她们在袁家界拍了很多照片，也给我买了一件礼物。" },
    { index: 3, sequence: "红白机", sentence: "我们要一起看照片，还要玩红白机。" },
  ]);

  // Each answer is a proposal with its source, its meaning and the AI badge.
  const badge = fill(en.aiNotice.badge, { model: GROQ_MODEL });
  const name = card(main, "王芳");
  await expect(
    name.getByText(`${en.unknownWords.source.ai} · ${en.unknownWords.kind.person}`),
  ).toBeVisible();
  await expect(name.getByText("Wang Fang, Chinese name")).toBeVisible();
  await expect(name.getByText(badge)).toBeVisible();
  const game = card(main, "红白机");
  await expect(
    game.getByText(`${en.unknownWords.source.ai} · ${en.unknownWords.kind.word}`),
  ).toBeVisible();
  await expect(game.getByText("Nintendo Entertainment System")).toBeVisible();
  // « Not a word » proposes nothing and points to « Fix the sequence ».
  const fragment = card(main, "袁家界拍");
  await expect(fragment.getByText(en.unknownWords.noProposal)).toBeVisible();
  await expect(fragment.getByText(/^AI: not a word, .*checked on /u)).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  // Every answer is kept with its provenance: nothing is left to send.
  expect(await rowsOf(page, "resolutions")).toHaveLength(SENT.length);
  await expect(asked).toHaveAttribute("aria-disabled", "true");
  await expect(asked).toHaveAccessibleDescription(en.aiExplain.nothingToSend);

  // Nothing is applied before the learner accepts.
  expect(await rowsOf(page, "lexicon")).toEqual([]);
  await press(page, name.getByRole("button", { name: en.unknownWords.accept }));
  await expect(main.getByRole("button", { name: en.unknownWords.undo })).toBeFocused();
  expect(await rowsOf(page, "lexicon")).toMatchObject([
    {
      headword: "王芳",
      kind: "person",
      gloss: "Wang Fang, Chinese name",
      source: "ai",
      provenance: { provider: "groq", model: GROQ_MODEL, promptVersion: "zh-explain-v1" },
    },
  ]);
});

test("says an invalid answer or a network error, keeps nothing and asks again only when pressed", async ({
  page,
}) => {
  const short = answerOf(GROQ, (items) => items.slice(0, 2));
  let next: readonly Exchange[] | null = [short];
  const sent = await replay(page, AI_BASE_URLS.groq, () => next);
  await seed(page, settingsOf("groq"));
  const main = await openPanel(page);

  await press(page, main.getByRole("button", { name: en.aiExplain.ask }));
  await confirmNotice(page);
  const alert = main.getByRole("alert");
  await expect(alert).toContainText(en.ai.errors["invalid-response"]);
  const retry = main.getByRole("button", { name: en.aiExplain.retry });
  await expect(retry).toBeFocused();
  expect(await rowsOf(page, "resolutions")).toEqual([]);
  expect(sent).toHaveLength(1);
  expect(await accessibilityViolations(page)).toEqual([]);

  next = null;
  await press(page, retry);
  await expect(alert).toContainText(
    fill(en.ai.errors.network, { provider: en.aiNotice.providers.groq }),
  );
  await expect(retry).toBeFocused();
  expect(await rowsOf(page, "resolutions")).toEqual([]);

  next = [GROQ_ANSWER];
  await press(page, retry);
  await expect(
    main
      .getByRole("status")
      .filter({ hasText: fill(en.aiExplain.answered_other, { count: SENT.length }) }),
  ).toBeVisible();
  expect(await rowsOf(page, "resolutions")).toHaveLength(SENT.length);
});

test("asks a local Ollama server, without a key", async ({ page }) => {
  const sent = await replay(page, AI_BASE_URLS.local, () => [answerOf(OLLAMA, (items) => items)]);
  await seed(page, settingsOf("local"));
  const main = await openPanel(page);
  const ask = main.getByRole("button", { name: en.aiExplain.ask });
  await expect(ask).toHaveAccessibleDescription(new RegExp(en.aiNotice.providers.local, "u"));

  await press(page, ask);
  await confirmNotice(page);
  await expect(
    card(main, "王芳").getByText(fill(en.aiNotice.badge, { model: OLLAMA_MODEL })),
  ).toBeVisible();
  await expect(card(main, "红白机").getByText("a gaming console")).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(sent[0]?.url).toBe(`${AI_BASE_URLS.local}/chat/completions`);
  expect(sent[0]?.authorization).toBeNull();
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("needs a provider: no button, a link to the AI settings", async ({ page }) => {
  const sent = await replay(page, AI_BASE_URLS.groq, () => null);
  await seed(page, null);
  const main = await openPanel(page);
  await expect(main.getByText(en.aiExplain.noProvider)).toBeVisible();
  await expect(main.getByRole("link", { name: en.aiExplain.toSettings })).toHaveAttribute(
    "href",
    "/profile#ai",
  );
  await expect(main.getByRole("button", { name: en.aiExplain.ask })).toHaveCount(0);
  expect(await accessibilityViolations(page)).toEqual([]);
  expect(sent).toHaveLength(0);
});
