import { proficiencyFrameworks } from "@openlinguo/core";
import {
  Approval,
  NewStatementOfReasons,
  type StatementOfReasons,
} from "@openlinguo/core/moderation";
import { LICENCES, type Submission } from "@openlinguo/core/submission";
import { expect, type Page, type Route } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { moderationEn as m } from "../src/i18n/moderation/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

const pending = (id: string, title: string, body: string, createdAt: string): Submission => ({
  id,
  title,
  body,
  origin: "human",
  provenance: null,
  licence: LICENCES.human,
  attribution: null,
  status: "pending",
  attestationVersion: 1,
  attestedAt: createdAt,
  createdAt,
});

// `vite preview` has no Functions: the API answers here, checking requests against the contract.
type FakeApi = {
  readonly queue: Submission[];
  readonly approved: { readonly id: string; readonly band: number }[];
  readonly restricted: { readonly id: string; readonly measure: string; readonly body: unknown }[];
  refusal: { readonly status: number; readonly code: string } | null;
};

const fakeApi = async (page: Page): Promise<FakeApi> => {
  const api: FakeApi = {
    queue: [
      pending("s1", "我的周末", "我周末去公园。公园很大。", "2026-10-30T09:00:00.000Z"),
      pending("s2", "小猫", "小猫很可爱。", "2026-10-31T09:00:00.000Z"),
    ],
    approved: [],
    restricted: [],
    refusal: null,
  };
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (api.refusal !== null) {
      await json(route, api.refusal.status, { code: api.refusal.code, message: "refused" });
      return;
    }
    if (pathname === "/api/admin/queue") {
      await json(route, 200, api.queue);
      return;
    }
    const [, id = "", action = null] =
      /^\/api\/admin\/submissions\/([^/]+)(?:\/(\w+))?$/u.exec(pathname) ?? [];
    const found = api.queue.find((submission) => submission.id === id);
    if (!found) {
      await json(route, 404, { code: "NOT_FOUND", message: pathname });
      return;
    }
    if (action === null) {
      await json(route, 200, found);
      return;
    }
    if (action === "approve") {
      api.approved.push({ id, band: Approval.parse(request.postDataJSON()).band });
      await route.fulfill({ status: 204 });
      return;
    }
    const statement = NewStatementOfReasons.parse(request.postDataJSON());
    const measure = action === "reject" ? "rejected" : "removed";
    api.restricted.push({ id, measure, body: request.postDataJSON() });
    const decided: StatementOfReasons = {
      ...statement,
      id: "d1",
      submissionId: id,
      measure,
      source: "own-initiative",
      automated: false,
      decidedAt: new Date().toISOString(),
    };
    await json(route, 201, decided);
  });
  return api;
};

/** The first visit imports the offline dictionary the level is estimated with. */
const dataReady = async (page: Page): Promise<void> => {
  await page.goto("/read");
  await expect(page.getByRole("main").getByText(en.library.emptyTitle)).toBeVisible({
    timeout: 90_000,
  });
};

const press = async (page: Page, name: string, key = "Enter"): Promise<void> => {
  await page
    .getByRole("main")
    .getByRole("link", { name, exact: true })
    .or(page.getByRole("main").getByRole("button", { name, exact: true }))
    .focus();
  await page.keyboard.press(key);
};

test.use({ serviceWorkers: "block" });

test("approves the oldest text with its estimated level, after the six checks", async ({
  page,
}) => {
  const api = await fakeApi(page);
  await dataReady(page);
  const main = page.getByRole("main");
  await page.goto("/admin");
  await expect(main.getByRole("heading", { level: 1, name: m.title })).toBeVisible();
  await expect(main.locator("ol").getByRole("listitem").first()).toContainText("我的周末");
  await expect(main.locator("ol").getByRole("listitem")).toHaveCount(2);
  expect(await accessibilityViolations(page)).toEqual([]);

  await press(page, "我的周末");
  await expect(main.getByRole("heading", { level: 1, name: "我的周末" })).toBeVisible();
  const band = main.getByText(/^HSK (\d|7-9) · estimated$/u);
  await expect(band).toBeVisible({ timeout: 60_000 });
  await expect(main.getByRole("table", { name: m.level.caption })).toBeVisible();
  const shown = /^HSK (.+) · estimated$/u.exec((await band.textContent()) ?? "")?.[1] ?? "";
  const bands: readonly string[] = proficiencyFrameworks["hsk-2025"];
  expect(await accessibilityViolations(page)).toEqual([]);

  await press(page, m.approve);
  const alert = main.getByRole("alert");
  await expect(alert).toHaveText(m.failure.unticked);
  await expect(alert).toBeFocused();
  expect(api.approved).toEqual([]);

  for (const label of Object.values(m.checklist.items)) {
    await main.getByRole("checkbox", { name: label }).focus();
    await page.keyboard.press("Space");
  }
  await press(page, m.approve);
  await expect(main.getByRole("heading", { name: m.approved })).toBeFocused();
  expect(api.approved).toEqual([{ id: "s1", band: bands.indexOf(shown) + 1 }]);
  await expect(main.getByText(`It is in the library at HSK ${shown}.`)).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("rejects a text with a statement of reasons, kept when the mail fails", async ({ page }) => {
  const api = await fakeApi(page);
  await dataReady(page);
  const main = page.getByRole("main");
  await page.goto("/admin/s2");
  await expect(main.getByRole("heading", { level: 1, name: "小猫" })).toBeVisible();
  await press(page, m.reject);
  await expect(main.getByRole("heading", { name: m.statement.title })).toBeVisible();
  await expect(main.getByText(m.statement.measureRejected)).toBeVisible();
  await expect(main.getByText(m.statement.automatedValue)).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  await press(page, m.statement.sendRejected);
  await expect(main.getByRole("alert")).toHaveText(m.failure.ground);
  await expect(main.getByRole("alert")).toBeFocused();

  const ground = main.getByRole("combobox", { name: m.statement.ground });
  await ground.selectOption("personal-data");
  await expect(main.getByText(m.statement.personalDataHelp)).toBeVisible();
  await ground.selectOption("not-chinese");
  await expect(main.getByText(m.statement.personalDataHelp)).toBeHidden();
  await main.getByRole("textbox", { name: m.statement.facts }).focus();
  await page.keyboard.type("The text is a list of English words.");
  await main.getByRole("textbox", { name: m.statement.explanation }).focus();
  await page.keyboard.type("The library takes texts in Chinese.");
  api.refusal = { status: 502, code: "MAIL_FAILED" };
  await press(page, m.statement.sendRejected);
  await expect(main.getByRole("alert")).toHaveText(m.failure.mail);
  await expect(main.getByRole("alert")).toBeFocused();
  await expect(main.getByRole("textbox", { name: m.statement.facts })).toHaveValue(
    "The text is a list of English words.",
  );
  expect(await accessibilityViolations(page)).toEqual([]);

  api.refusal = null;
  await press(page, m.statement.sendRejected);
  await expect(main.getByRole("heading", { name: m.statement.sent })).toBeFocused();
  expect(api.restricted).toEqual([
    {
      id: "s2",
      measure: "rejected",
      body: {
        ground: "not-chinese",
        facts: "The text is a list of English words.",
        explanation: "The library takes texts in Chinese.",
      },
    },
  ]);
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("refuses an account that is not admin, and sends the admin to verify the code", async ({
  page,
}) => {
  const api = await fakeApi(page);
  api.refusal = { status: 403, code: "ADMIN_REQUIRED" };
  await page.goto("/admin");
  const main = page.getByRole("main");
  await expect(main.getByRole("alert")).toHaveText(m.failure.admin);
  await expect(main.getByRole("link", { name: m.account, exact: true })).toHaveCount(1);
  expect(await accessibilityViolations(page)).toEqual([]);

  api.refusal = { status: 403, code: "TWO_FACTOR_REQUIRED" };
  await press(page, m.retry);
  await expect(main.getByRole("alert")).toHaveText(m.failure.twoFactor);
  await expect(main.getByRole("link", { name: m.account, exact: true })).toHaveCount(2);
  expect(await accessibilityViolations(page)).toEqual([]);
});
