import { expect, type Page } from "@playwright/test";
import { TIMING_BUDGETS } from "../src/build/budgets.ts";
import { test } from "./app.ts";
import { ROUTE_VISITS } from "./routes.ts";

// A trace would slow the page down by half: this test measures it.
test.use({ seeded: false, trace: "off" });
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "CPU throttling is a Chromium DevTools feature",
);

/** The median of these visits is the next visit's time: one slow reload is not a regression. */
const WARM_VISITS = 3;
const { cpuSlowdown, coldUsableMs, warmUsableMs } = TIMING_BUDGETS;

/** Milliseconds from the navigation to the Today page showing: the import gate is lifted. */
const usableAfter = async (page: Page, navigate: () => Promise<unknown>): Promise<number> => {
  const start = Date.now();
  await navigate();
  await ROUTE_VISITS["/"]?.ready(page).waitFor({ timeout: 10 * coldUsableMs });
  return Date.now() - start;
};

test(`the first visit is usable in ${String(coldUsableMs)} ms and the next in ${String(warmUsableMs)} ms at ${String(cpuSlowdown)}x CPU`, async ({
  page,
  context,
}) => {
  test.setTimeout(20 * coldUsableMs);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuSlowdown });

  const cold = await usableAfter(page, () => page.goto("/"));
  await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  const warms: number[] = [];
  for (let visit = 0; visit < WARM_VISITS; visit += 1) {
    warms.push(await usableAfter(page, () => page.reload()));
  }
  const warm = [...warms].sort((a, b) => a - b)[Math.floor(WARM_VISITS / 2)] ?? Infinity;
  test.info().annotations.push({
    type: "usable",
    description: `cold ${String(cold)} ms, warm ${String(warm)} ms`,
  });
  console.log(`performance: first visit ${String(cold)} ms, next visits ${warms.join(", ")} ms`);

  expect(
    cold,
    "first visit: the offline data import got slower; see src/build/budgets.ts for what to do",
  ).toBeLessThanOrEqual(coldUsableMs);
  expect(
    warm,
    "next visit: the data must not be imported again; see src/build/budgets.ts",
  ).toBeLessThanOrEqual(warmUsableMs);
});
