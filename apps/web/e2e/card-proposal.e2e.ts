import { expect } from "@playwright/test";
import { z } from "zod";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { replay } from "./ai-replay.ts";
import { test } from "./app.ts";
import {
  CORRECTED,
  fill,
  LOCAL_SERVER,
  MODEL,
  seedChallenge,
  storedRows,
} from "./challenge-seed.ts";

const Note = z.object({
  id: z.string(),
  characters: z.string(),
  pinyin: z.string(),
  meaning: z.string(),
  provenance: z.unknown(),
});
const Filing = z.object({ deckId: z.string(), note: z.string().optional() });
const Card = z.object({ note: z.string().optional(), type: z.string() });

// Requests from a page a service worker controls escape `page.route` in WebKit.
test.use({ serviceWorkers: "block" });

test("makes a card from an accepted correction: pinyin checked, confirmed, once per deck", async ({
  page,
}) => {
  const main = page.getByRole("main");
  const focused = page.locator(":focus");
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  await page.clock.setFixedTime(noon);
  const day = [noon.getFullYear(), noon.getMonth() + 1, noon.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
  await replay(page, LOCAL_SERVER, () => CORRECTED);
  await page.goto("/");
  await seedChallenge(page);

  await page.goto(`/learn/challenges/${day}`);
  const correct = main.getByRole("button", { name: en.correction.correct, exact: true });
  await correct.click({ timeout: 90_000 });
  await page.getByRole("dialog").getByRole("button", { name: en.aiNotice.confirm }).click();
  const third = main.getByRole("region", { name: "Sentence 3" });
  const accept = third.getByRole("button", { name: en.correction.accept });
  await expect(accept).toBeFocused();
  await expect(third.getByRole("button", { name: en.cardProposal.make })).toHaveCount(0);
  await page.keyboard.press("Enter");
  const make = third.getByRole("button", { name: en.cardProposal.make });
  await make.focus();
  await page.keyboard.press("Enter");

  // The proposal: the corrected sentence, the AI's pinyin and meaning, « My words » first.
  const proposal = main.getByRole("region", { name: en.cardProposal.title });
  await expect(focused).toContainText(en.cardProposal.title);
  await expect(third).toBeHidden();
  await expect(proposal).toContainText(fill(en.cardProposal.intro, { number: 3 }));
  await expect(proposal).toContainText(fill(en.aiNotice.badge, { model: MODEL }));
  const sentence = proposal.getByRole("textbox", { name: en.cardProposal.sentence });
  const pinyin = proposal.getByRole("textbox", { name: en.cardProposal.pinyin });
  const meaning = proposal.getByRole("textbox", { name: en.cardProposal.meaning });
  await expect(sentence).toHaveValue("我的电话很新。");
  await expect(pinyin).toHaveValue("wǒ de diàn huà hěn xīn .");
  await expect(meaning).toHaveValue("My phone is new.");
  await expect(proposal.getByRole("combobox", { name: en.cardProposal.deck })).toHaveValue(
    "my-words",
  );
  await expect(pinyin).toHaveAttribute("aria-invalid", "false");

  // A syllable the dictionary does not give is a field error, and the card is refused.
  await pinyin.fill("wǒ de diàn huà hěn xìn .");
  await expect(pinyin).toHaveAttribute("aria-invalid", "true");
  await expect(pinyin).toHaveAccessibleDescription(
    fill(en.cardProposal.readingFlag, { written: "xìn", character: "新", readings: "xīn" }),
  );
  await expect(pinyin).toHaveValue("wǒ de diàn huà hěn xìn .");
  expect(await accessibilityViolations(page)).toEqual([]);
  const confirm = proposal.getByRole("button", { name: en.cardProposal.confirm });
  await expect(confirm).toHaveAccessibleDescription(en.cardProposal.cards);
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(pinyin).toBeFocused();
  expect(await storedRows(page, "notes")).toEqual([]);

  await pinyin.fill("wǒ de diàn huà hěn xīn .");
  await meaning.fill("My phone is brand new.");
  await expect(pinyin).toHaveAttribute("aria-invalid", "false");
  await confirm.focus();
  await page.keyboard.press("Enter");

  // Created on confirmation, with its provenance, two cards, in « My words ».
  const made = fill(en.cardProposal.made, { deck: en.decks.myWords });
  await expect(make).toBeFocused();
  await expect(make).toHaveAccessibleDescription(`Sentence 3 ${made}`);
  await expect(third).toContainText(made);
  const notes = z.array(Note).parse(await storedRows(page, "notes"));
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatchObject({
    characters: "我的电话很新。",
    pinyin: "wǒ de diàn huà hěn xīn .",
    meaning: "My phone is brand new.",
    provenance: { origin: "ai", provider: "local", model: MODEL, promptVersion: "zh-correct-v1" },
  });
  const note = notes[0]?.id ?? "";
  const filings = z.array(Filing).parse(await storedRows(page, "deckWords"));
  expect(filings.filter((filing) => filing.note === note).map((filing) => filing.deckId)).toEqual([
    "my-words",
  ]);
  const cards = z.array(Card).parse(await storedRows(page, "cards"));
  expect(
    cards
      .filter((card) => card.note === note)
      .map((card) => card.type)
      .sort(),
  ).toEqual(["recall", "recognition"]);
  expect(await accessibilityViolations(page)).toEqual([]);

  // The same sentence in the same deck is refused, in the dark theme too.
  await page.keyboard.press("Enter");
  await expect(focused).toContainText(en.cardProposal.title);
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(proposal.getByRole("alert")).toHaveText(
    fill(en.cardProposal.alreadyFiled, { deck: en.decks.myWords }),
  );
  expect(await storedRows(page, "notes")).toHaveLength(1);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.getAnimations().length === 0);
  expect(await accessibilityViolations(page)).toEqual([]);
  await proposal.getByRole("button", { name: en.cardProposal.cancel }).click();
  await expect(make).toBeFocused();
  await expect(proposal).toHaveCount(0);
});
