import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { recording, type Exchange, type Recording } from "./ai-replay.ts";
import { put } from "./seed.ts";
import { press, seedText } from "./unknown-words-panel.ts";

/** Groq's recommended model and Ollama's real answers to the explain prompt (`record:ai … explain`). */
export const GROQ = recording(new URL("fixtures/ai/groq-explain.json", import.meta.url));
export const OLLAMA = recording(new URL("fixtures/ai/local-explain.json", import.meta.url));
export const KEY = "gsk_e2e-key-for-explanations";

/** The recorded sentences without 冯文敏; 张家界, which the dictionary has, is left out of the answers. */
export const BODY =
  "我的同学王芳和老师去张家界玩了。她们在袁家界拍了很多照片，也给我买了一件礼物。我们要一起看照片，还要玩红白机。";
export const SEQUENCES = ["王芳", "袁家界拍", "红白机"];
const RECORDED_INDICES = [1, 3, 4];
/** Runs of common words, sent after the others: the recordings have no answer for them. */
export const COMMON = ["我的", "玩了", "也给我买了一件"];
export const SENT = [...SEQUENCES, ...COMMON];

const Completion = z.looseObject({
  choices: z.array(z.looseObject({ message: z.looseObject({ content: z.string() }) })),
});
const Item = z.object({ index: z.number(), kind: z.string(), meaning: z.string() });
type Item = z.output<typeof Item>;

/**
 * The recorded chat exchange, its answer cut to the sequences of the text and numbered again, and
 * « not a word » for the common runs.
 */
export const answerOf = (
  { exchanges }: Recording,
  rewrite: (items: Item[]) => Item[],
): Exchange => {
  const exchange = exchanges.find(
    ({ request, response }) => request.path === "/chat/completions" && response.status === 200,
  );
  if (exchange == null) throw new Error("no recorded explanation");
  const completion = Completion.parse(exchange.response.body);
  const content = completion.choices[0]?.message.content ?? "";
  const items = z.object({ sequences: z.array(Item) }).parse(JSON.parse(content)).sequences;
  const kept = [
    ...RECORDED_INDICES.flatMap((recorded, at) =>
      items.filter(({ index }) => index === recorded).map((item) => ({ ...item, index: at + 1 })),
    ),
    ...COMMON.map((_, at) => ({
      index: SEQUENCES.length + at + 1,
      kind: "not-a-word",
      meaning: "",
    })),
  ];
  return {
    ...exchange,
    response: {
      ...exchange.response,
      body: {
        ...completion,
        choices: completion.choices.map((choice) => ({
          ...choice,
          message: { ...choice.message, content: JSON.stringify({ sequences: rewrite(kept) }) },
        })),
      },
    },
  };
};

export const GROQ_ANSWER = answerOf(GROQ, (items) => items);
export const GROQ_MODEL = GROQ.model ?? "";
export const OLLAMA_MODEL = OLLAMA.model ?? "";

export const settingsOf = (provider: "groq" | "local") => ({
  id: "ai",
  provider,
  localAddress: "http://localhost:11434",
  rememberKey: true,
  key: provider === "groq" ? { provider, value: KEY } : null,
  model: { provider, id: provider === "groq" ? GROQ_MODEL : OLLAMA_MODEL, mode: "json_schema" },
});

export const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replaceAll(/\{\{(\w+)(?:, number)?\}\}/gu, (_, name: string) => String(values[name]));

/** The text of the recordings in the library, and a provider when `settings` is given. */
export const seed = async (page: Page, settings: object | null): Promise<void> => {
  await seedText(page, BODY);
  if (settings !== null) await put(page, "aiSettings", settings);
};

export const confirmNotice = async (page: Page): Promise<void> => {
  const notice = page.getByRole("dialog", { name: en.aiNotice.title });
  await expect(notice).toContainText(
    fill(en.aiNotice.uses.explanation, { action: en.aiExplain.ask }),
  );
  expect(await accessibilityViolations(page)).toEqual([]);
  await press(page, notice.getByRole("button", { name: en.aiNotice.confirm }));
  await expect(notice).toHaveCount(0);
};
