import { expect } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";
import { card, openPanel, press, rowsOf, seedText } from "./unknown-words-panel.ts";
import {
  itemsOf,
  labelled,
  merged,
  recorded,
  replayWikidata,
  type Reply,
} from "./wikidata-replay.ts";

/** None of the three sequences is in CC-CEDICT: 王芳 has homonyms, 王小红 none, 丁丹妮 one. */
const BODY = "我们和王芳去学校。他和王小红说话。我认识丁丹妮。";
const SEQUENCES = ["王芳", "王小红", "丁丹妮"];

const HOMONYMS = recorded("homonyms").results.bindings;
const HOMONYM_COUNT = itemsOf(HOMONYMS);
/** Wikidata's recorded rows: 王芳 as returned, 周杰伦 read as 丁丹妮 (the dictionary has 周杰伦). */
const ANSWER = merged(HOMONYMS, labelled(recorded("found"), "周杰伦", "丁丹妮"));
const SINGER = "Taiwanese pop singer, songwriter, and actor";
const ACTRESS = "Kunqu actress (1963-)";

const ALL_CHECKED = "3 sequences checked, 2 with a result.";

// Requests from a page a service worker controls escape `page.route` in WebKit.
test.use({ serviceWorkers: "block" });

test("searches Wikidata after the notice and proposes what it found, the homonyms and nothing", async ({
  page,
}) => {
  await seedText(page, BODY);
  const requests = await replayWikidata(page, () => ({ kind: "answer", body: ANSWER }));
  const main = await openPanel(page);
  await expect(main.getByRole("heading", { level: 2 })).toHaveText(SEQUENCES);

  // The line under the button says what the click sends, before the click.
  const search = main.getByRole("button", { name: en.wikidata.search });
  await expect(search).toHaveAccessibleDescription(
    /^Sent: 王芳、王小红、丁丹妮, your IP address and your browser, to Wikidata \(Wikimedia Foundation, United States\)\./u,
  );
  expect(await accessibilityViolations(page)).toEqual([]);

  // The notice comes first, with focus on the confirmation; nothing is sent before it.
  await press(page, search);
  const notice = page.getByRole("dialog", { name: en.wikidata.notice.title });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("button", { name: en.wikidata.notice.confirm })).toBeFocused();
  expect(requests).toHaveLength(0);
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.keyboard.press("Enter");

  await expect(main.getByRole("status").filter({ hasText: ALL_CHECKED })).toBeVisible();
  await expect(search).toBeFocused();
  expect(requests).toHaveLength(1);
  const [sent] = requests;
  expect(`${sent?.url.origin ?? ""}${sent?.url.pathname ?? ""}`).toBe(
    "https://query.wikidata.org/sparql",
  );
  const query = sent?.url.searchParams.get("query") ?? "";
  for (const sequence of SEQUENCES) {
    expect(query).toContain(`"${sequence}"@zh "${sequence}"@zh-hans`);
  }
  expect(query).not.toContain("学校");
  expect(sent?.headers["api-user-agent"]).toBe("OpenLinguo (https://github.com/R4z4kk/OpenLinguo)");
  expect(sent?.headers["referer"]).toBeUndefined();
  expect(sent?.headers["cookie"]).toBeUndefined();

  // Found: the type, the description and the item to check it on.
  const singer = card(main, "丁丹妮");
  await expect(
    singer.getByText(`${en.unknownWords.source.wikidata} · ${en.unknownWords.kind.person}`),
  ).toBeVisible();
  await expect(singer.getByText(SINGER)).toBeVisible();
  await expect(singer.getByRole("link", { name: /^Wikidata item Q238819/u })).toHaveAttribute(
    "href",
    "https://www.wikidata.org/wiki/Q238819",
  );

  // Nothing found is an answer too, with its date.
  await expect(
    card(main, "王小红").getByText(/^Wikidata: nothing found, checked on /u),
  ).toBeVisible();

  // Homonyms: five first, the others on request.
  const name = card(main, "王芳");
  await expect(name.locator("li")).toHaveCount(5);
  const others = name.getByRole("button", {
    name: `Show the ${String(HOMONYM_COUNT - 5)} others`,
    exact: true,
  });
  await expect(others).toHaveAttribute("aria-expanded", "false");
  expect(await accessibilityViolations(page)).toEqual([]);
  await press(page, others);
  await expect(name.locator("li")).toHaveCount(HOMONYM_COUNT);
  await expect(name.getByRole("button", { name: en.wikidata.fewer })).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);

  // The learner picks one: it joins the lexicon with its source, and Undo takes it back.
  const actress = name.locator("li").filter({ hasText: ACTRESS });
  await press(page, actress.getByRole("button", { name: en.unknownWords.accept }));
  await expect(main.getByRole("button", { name: en.unknownWords.undo })).toBeFocused();
  expect(await rowsOf(page, "lexicon")).toMatchObject([
    { headword: "王芳", kind: "person", gloss: ACTRESS, source: "wikidata" },
  ]);
  await page.keyboard.press("Enter");
  await expect(name.getByRole("heading", { level: 2, name: "王芳" })).toBeFocused();
  expect(await rowsOf(page, "lexicon")).toEqual([]);

  // None of them: the proposals go, the answer stays.
  await press(page, name.getByRole("button", { name: en.wikidata.none }));
  await expect(
    main.getByRole("status").filter({ hasText: en.unknownWords.rejected }),
  ).toBeVisible();
  await expect(name.getByText(en.unknownWords.noProposal)).toBeVisible();
  await expect(name.getByText(/^Wikidata: \d+ results, checked on /u)).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  // Every answer is kept, found or not: back on the page nothing is left to send.
  expect(await rowsOf(page, "resolutions")).toHaveLength(3);
  await page.reload();
  await expect(main.getByRole("heading", { level: 2 })).toHaveText(SEQUENCES, { timeout: 60_000 });
  await expect(search).toHaveAttribute("aria-disabled", "true");
  await expect(search).toHaveAccessibleDescription(en.wikidata.nothingToSend);
  await expect(name.locator("li")).toHaveCount(5);
  await press(page, search);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("shows a network error, then a 429, retries nothing on its own and keeps nothing", async ({
  page,
}) => {
  await seedText(page, BODY);
  const replies: readonly Reply[] = [
    { kind: "unreachable" },
    { kind: "status", status: 429 },
    { kind: "answer", body: ANSWER },
  ];
  let calls = 0;
  const requests = await replayWikidata(page, () => replies[calls++] ?? { kind: "unreachable" });
  const main = await openPanel(page);
  const search = main.getByRole("button", { name: en.wikidata.search });

  await press(page, search);
  await page.getByRole("button", { name: en.wikidata.notice.confirm }).click();
  const alert = main.getByRole("alert");
  await expect(alert).toHaveText(`${en.wikidata.failed.network} ${en.wikidata.retry}`);
  await expect(search).toBeFocused();
  expect(await accessibilityViolations(page)).toEqual([]);
  await page.waitForTimeout(1000);
  expect(requests).toHaveLength(1);
  expect(await rowsOf(page, "resolutions")).toEqual([]);

  // The notice is not shown again; a 429 is told as such.
  await press(page, search);
  await expect(alert).toHaveText(`${en.wikidata.failed["rate-limited"]} ${en.wikidata.retry}`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(requests).toHaveLength(2);
  expect(await rowsOf(page, "resolutions")).toEqual([]);
  expect(await accessibilityViolations(page)).toEqual([]);

  // The learner tries again by hand and it goes through.
  await press(page, search);
  await expect(main.getByRole("status").filter({ hasText: ALL_CHECKED })).toBeVisible();
  await expect(alert).toHaveCount(0);
  expect(requests).toHaveLength(3);
});

test("sends nothing when the notice is cancelled, and shows it again", async ({ page }) => {
  await seedText(page, BODY);
  const requests = await replayWikidata(page, () => ({ kind: "answer", body: ANSWER }));
  const main = await openPanel(page);
  const search = main.getByRole("button", { name: en.wikidata.search });
  const notice = page.getByRole("dialog", { name: en.wikidata.notice.title });

  await press(page, search);
  await expect(notice).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(notice).toHaveCount(0);
  await expect(search).toBeFocused();

  await press(page, search);
  await press(page, notice.getByRole("button", { name: en.wikidata.notice.cancel }));
  await expect(notice).toHaveCount(0);
  await expect(search).toBeFocused();
  expect(requests).toHaveLength(0);
  expect(await rowsOf(page, "resolutions")).toEqual([]);

  await press(page, search);
  await press(page, notice.getByRole("button", { name: en.wikidata.notice.confirm }));
  await expect(main.getByRole("status").filter({ hasText: ALL_CHECKED })).toBeVisible();
  expect(requests).toHaveLength(1);
});

test("stops a search the learner cancels and keeps nothing it did not receive", async ({
  page,
}) => {
  await seedText(page, BODY);
  const requests = await replayWikidata(page, () => new Promise<Reply>(() => null));
  const main = await openPanel(page);
  const search = main.getByRole("button", { name: en.wikidata.search });

  await press(page, search);
  await press(page, page.getByRole("button", { name: en.wikidata.notice.confirm }));
  const cancel = main.getByRole("button", { name: en.wikidata.cancel });
  await expect(cancel).toBeFocused();
  const searching = main.getByRole("button", { name: en.wikidata.searching });
  await expect(searching).toHaveAttribute("aria-disabled", "true");
  expect(await accessibilityViolations(page)).toEqual([]);

  await page.keyboard.press("Enter");
  await expect(main.getByRole("status").filter({ hasText: /^Search cancelled\./u })).toBeVisible();
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute("aria-disabled", "false");
  expect(requests).toHaveLength(1);
  expect(await rowsOf(page, "resolutions")).toEqual([]);
});
