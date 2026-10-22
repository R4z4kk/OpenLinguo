import { expect, type Page } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { test } from "./app.ts";
import { put } from "./seed.ts";

const CHARACTERS = 20_000;
/** The median open of a typical text takes this long at most, from the start of the page to its last word. */
const BUDGET_MS = 15_000;
/** Every word distinct: far more lookups than any real text of this size causes. */
const WORST_CASE_BUDGET_MS = 90_000;

/** Distinct two-character words of the dictionary, in index order. */
const twoCharacterWords = (page: Page): Promise<readonly string[]> =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open("openlinguo");
        open.onerror = () => {
          reject(new Error(String(open.error)));
        };
        open.onsuccess = () => {
          const words: string[] = [];
          const request = open.result
            .transaction("entries")
            .objectStore("entries")
            .index("simplified")
            .openKeyCursor(null, "nextunique");
          request.onerror = () => {
            reject(new Error(String(request.error)));
          };
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor === null) {
              open.result.close();
              resolve(words);
              return;
            }
            if (typeof cursor.key === "string" && /^\p{Script=Han}{2}$/u.test(cursor.key))
              words.push(cursor.key);
            cursor.continue();
          };
        };
      }),
  );

/** Every `step`-th word, so the sample spreads over the whole dictionary. */
const spread = (words: readonly string[], count: number): readonly string[] =>
  Array.from(
    { length: count },
    (_, index) => words[(index * Math.floor(words.length / count)) % words.length] ?? "",
  );

/** A deterministic shuffle: the same text on every run and browser. */
const shuffled = (words: readonly string[]): readonly string[] => {
  const result = [...words];
  let seed = 12345;
  for (let index = result.length - 1; index > 0; index -= 1) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    const other = seed % (index + 1);
    [result[index], result[other]] = [result[other] ?? "", result[index] ?? ""];
  }
  return result;
};

/** Words in clauses of ten, paragraphs of four clauses, cut at `CHARACTERS`. */
const textOf = (words: readonly string[]): string => {
  const clauses: string[] = [];
  for (let index = 0; index < words.length; index += 10)
    clauses.push(words.slice(index, index + 10).join(""));
  const paragraphs: string[] = [];
  for (let index = 0; index < clauses.length; index += 4)
    paragraphs.push(`${clauses.slice(index, index + 4).join("，")}。`);
  return Array.from(paragraphs.join("\n")).slice(0, CHARACTERS).join("");
};

type Case = { readonly body: string; readonly pinyin: string; readonly runs: number };

type Timing = {
  readonly words: number;
  /** Milliseconds from the navigation. */
  readonly startedAt: number;
  readonly annotate: number;
  readonly derive: number;
  readonly render: number;
  readonly total: number;
  /** The longest task of the page (Chromium only), `null` where the browser has no such entry. */
  readonly longestTask: number | null;
  /** Median milliseconds from an arrow key to the next frame. */
  readonly arrowKey: number;
};

/** Collects the long tasks of every page of this context, where the browser reports them. */
const watchLongTasks = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const durations: number[] = [];
    Object.defineProperty(window, "longTasks", { value: durations });
    if (PerformanceObserver.supportedEntryTypes.includes("longtask"))
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) durations.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
  });
};

const open = async (page: Page, id: string, pinyin: string): Promise<Timing> => {
  await page.evaluate((mode) => {
    localStorage.setItem("openlinguo.readerPinyin", mode);
  }, pinyin);
  await page.goto(`/read/${id}`);
  await expect(page.getByText("target ")).toBeVisible({ timeout: 120_000 });
  await page.waitForFunction(() => performance.getEntriesByName("reader:rendered").length > 0);
  // The last word is far below the screen: End must still reach it.
  const reachesEnd = await page.evaluate(() => {
    document.querySelector<HTMLElement>("p button[tabindex='0']")?.focus();
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
    return document.activeElement === [...document.querySelectorAll("p button")].at(-1);
  });
  expect(reachesEnd).toBe(true);
  const arrowKey = await page.evaluate(async () => {
    document.querySelector<HTMLElement>("p button[tabindex='0']")?.focus();
    const samples: number[] = [];
    for (let press = 0; press < 11; press += 1) {
      const start = performance.now();
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return Math.round(samples[5] ?? 0);
  });
  return page.evaluate((keyed) => {
    const at = (name: string): number => performance.getEntriesByName(name).at(-1)?.startTime ?? 0;
    const recorded: unknown = Reflect.get(window, "longTasks");
    const tasks = Array.isArray(recorded)
      ? recorded.filter((value): value is number => typeof value === "number")
      : [];
    return {
      words: document.querySelectorAll("p button").length,
      startedAt: Math.round(at("reader:start")),
      annotate: Math.round(at("reader:annotated") - at("reader:start")),
      derive: Math.round(at("reader:derived") - at("reader:annotated")),
      render: Math.round(at("reader:rendered") - at("reader:derived")),
      total: Math.round(at("reader:rendered")),
      longestTask: PerformanceObserver.supportedEntryTypes.includes("longtask")
        ? Math.round(Math.max(0, ...tasks))
        : null,
      arrowKey: keyed,
    };
  }, arrowKey);
};

test("segments, annotates and draws 20,000 characters", async ({ page, browserName }, testInfo) => {
  test.setTimeout(300_000);
  await watchLongTasks(page);
  const main = page.getByRole("main");
  await page.goto("/read");
  await expect(main.getByText(en.library.emptyTitle)).toBeVisible({ timeout: 90_000 });
  const dictionary = await twoCharacterWords(page);
  expect(dictionary.length).toBeGreaterThan(20_000);

  const base = spread(dictionary, Math.ceil(CHARACTERS / 2));
  // About a third of the words are distinct, as in running text.
  const typical = textOf(
    shuffled(spread(dictionary, Math.ceil(CHARACTERS / 6)).flatMap((word) => [word, word, word])),
  );
  const cases: Record<string, Case> = {
    typical: { body: typical, pinyin: "unknown", runs: 3 },
    // Every word is distinct: the most lookups a text of this size can cause.
    distinct: { body: textOf(base), pinyin: "unknown", runs: 1 },
    // The same text with no pinyin: what the ruby costs.
    plain: { body: typical, pinyin: "none", runs: 3 },
  };
  const results: Record<string, Timing> = {};
  for (const [name, { body, pinyin, runs }] of Object.entries(cases)) {
    expect(Array.from(body)).toHaveLength(CHARACTERS);
    const id = `00000000-0000-4000-8000-${String(Object.keys(results).length + 1).padStart(12, "0")}`;
    await put(page, "texts", {
      id,
      title: name,
      body,
      source: "paste",
      createdAt: Date.now(),
      provenance: null,
      readingChoices: {},
    });
    const first = await open(page, id, pinyin);
    const timings = [first];
    for (let run = 1; run < runs; run += 1) timings.push(await open(page, id, pinyin));
    // The run in the middle by its total: the numbers of one run stay consistent.
    results[name] = timings.toSorted((a, b) => a.total - b.total)[Math.floor(runs / 2)] ?? first;
  }
  const report = JSON.stringify({ browser: browserName, characters: CHARACTERS, ...results });
  console.log(`reader benchmark ${report}`);
  await testInfo.attach("reader-benchmark", { body: report, contentType: "application/json" });

  expect(results["typical"]?.total ?? Infinity).toBeLessThan(BUDGET_MS);
  expect(results["distinct"]?.total ?? Infinity).toBeLessThan(WORST_CASE_BUDGET_MS);
});
