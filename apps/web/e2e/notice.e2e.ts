import { AdminAccountDeletion } from "@openlinguo/core/account";
import {
  KeepNotice,
  NewNotice,
  NewStatementOfReasons,
  type Notice,
  type NoticeDecided,
} from "@openlinguo/core/moderation";
import { LICENCES, type LibraryItem, type Submission } from "@openlinguo/core/submission";
import { expect, type Page, type Route } from "@playwright/test";
import { en } from "../src/i18n/en.ts";
import { moderationEn as m } from "../src/i18n/moderation/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

const TEXT: LibraryItem = {
  id: "00000000-0000-4000-8000-0000000004a1",
  title: "我的猫",
  body: "我的猫很可爱。",
  attribution: null,
  origin: "human",
  provenance: null,
  licence: LICENCES.human,
  band: 1,
  publishedAt: "2026-10-31T12:00:00.000Z",
};

const SUBMISSION: Submission = {
  id: TEXT.id,
  title: TEXT.title,
  body: TEXT.body,
  origin: "human",
  provenance: null,
  licence: LICENCES.human,
  attribution: null,
  status: "approved",
  attestationVersion: 1,
  attestedAt: "2026-10-30T12:00:00.000Z",
  createdAt: "2026-10-30T12:00:00.000Z",
};

const NOTICE: Notice = {
  id: "n1",
  submissionId: TEXT.id,
  title: TEXT.title,
  reason: "copyright",
  explanation: "Copié du manuel, leçon 3.",
  name: "Lin Wei",
  email: "lin@example.test",
  createdAt: "2026-11-01T09:00:00.000Z",
  decision: null,
};

// `vite preview` has no Functions: the API answers here, checking requests against the contract.
type FakeApi = {
  readonly notices: NewNotice[];
  readonly kept: KeepNotice[];
  readonly removed: NewStatementOfReasons[];
  unsent: string[];
  readonly deletedAccounts: string[];
};

const fakeApi = async (page: Page): Promise<FakeApi> => {
  const api: FakeApi = { notices: [], kept: [], removed: [], unsent: [], deletedAccounts: [] };
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/library") {
      const summary = Object.fromEntries(Object.entries(TEXT).filter(([key]) => key !== "body"));
      await json(route, 200, { items: [summary], nextPage: null });
    } else if (pathname === `/api/library/${TEXT.id}`) {
      await json(route, 200, TEXT);
    } else if (pathname === "/api/notices") {
      const notice = NewNotice.parse(request.postDataJSON());
      api.notices.push(notice);
      await json(route, 201, {
        id: "n42",
        createdAt: new Date().toISOString(),
        receipt: notice.email === null ? "none" : "sent",
      });
    } else if (pathname === "/api/admin/accounts/delete") {
      const { email } = AdminAccountDeletion.parse(request.postDataJSON());
      if (email === "nobody@example.test") {
        await json(route, 404, { code: "NOT_FOUND", message: "No account with this address" });
      } else {
        api.deletedAccounts.push(email);
        await route.fulfill({ status: 204 });
      }
    } else if (pathname === "/api/admin/notices") {
      await json(route, 200, [NOTICE]);
    } else if (pathname === "/api/admin/notices/n1") {
      await json(route, 200, NOTICE);
    } else if (pathname === `/api/admin/submissions/${TEXT.id}`) {
      await json(route, 200, SUBMISSION);
    } else if (pathname === "/api/admin/notices/n1/keep") {
      api.kept.push(KeepNotice.parse(request.postDataJSON()));
      await json(route, 200, { unsent: api.unsent, statement: null } satisfies NoticeDecided);
    } else if (pathname === "/api/admin/notices/n1/remove") {
      const statement = NewStatementOfReasons.parse(request.postDataJSON());
      api.removed.push(statement);
      const decided: NoticeDecided = {
        unsent: api.unsent,
        statement: {
          ...statement,
          id: "d1",
          submissionId: TEXT.id,
          measure: "removed",
          source: "notice",
          automated: false,
          decidedAt: new Date().toISOString(),
        },
      };
      await json(route, 201, decided);
    } else {
      await json(route, 404, { code: "NOT_FOUND", message: pathname });
    }
  });
  return api;
};

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

test("reports a library text with the keyboard and gets a receipt", async ({ page }) => {
  const api = await fakeApi(page);
  await dataReady(page);
  const main = page.getByRole("main");
  await page.goto("/read/library");
  await press(page, `Report « ${TEXT.title} »`);
  await expect(main.getByRole("heading", { level: 1, name: en.report.title })).toBeVisible();
  await expect(main.getByText(`/read/library/${TEXT.id}`)).toBeVisible();
  await expect(main.getByText(en.report.warning)).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  await press(page, en.report.send);
  const alert = main.getByRole("alert");
  await expect(alert).toHaveText(en.report.failure.reason);
  await expect(alert).toBeFocused();

  await main.getByRole("combobox", { name: en.report.reason }).selectOption("copyright");
  await main
    .getByRole("textbox", { name: en.report.explanation })
    .fill("Copié du manuel, leçon 3.");
  await main.getByRole("textbox", { name: en.report.name }).fill("Lin Wei");
  await main.getByRole("textbox", { name: en.report.email }).fill("lin@example.test");
  await press(page, en.report.send);
  await expect(alert).toHaveText(en.report.failure.goodFaith);
  await main.getByRole("checkbox", { name: en.report.goodFaith }).focus();
  await page.keyboard.press("Space");
  await press(page, en.report.send);

  await expect(main.getByRole("heading", { name: en.report.sent })).toBeFocused();
  await expect(main.getByText("Notice number: n42")).toBeVisible();
  await expect(
    main.getByText("A receipt went to lin@example.test.", { exact: false }),
  ).toBeVisible();
  expect(api.notices).toEqual([
    {
      submissionId: TEXT.id,
      reason: "copyright",
      explanation: "Copié du manuel, leçon 3.",
      name: "Lin Wei",
      email: "lin@example.test",
      goodFaith: true,
    },
  ]);
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("reports child sexual abuse material with no name and no email", async ({ page }) => {
  const api = await fakeApi(page);
  await dataReady(page);
  const main = page.getByRole("main");
  await page.goto(`/report?text=${TEXT.id}`);
  await main.getByRole("combobox", { name: en.report.reason }).selectOption("child-sexual-abuse");
  await expect(main.getByText(en.report.identityOptional)).toBeVisible();
  await main.getByRole("textbox", { name: en.report.explanation }).fill("Image décrite ligne 2.");
  await main.getByRole("checkbox", { name: en.report.goodFaith }).check();
  await press(page, en.report.send);
  await expect(main.getByRole("heading", { name: en.report.sent })).toBeFocused();
  await expect(main.getByText(en.report.receipt.none)).toBeVisible();
  expect(api.notices[0]).toMatchObject({ name: null, email: null });
});

test("removes a reported text with a statement of reasons", async ({ page }) => {
  const api = await fakeApi(page);
  await dataReady(page);
  const main = page.getByRole("main");
  await page.goto("/admin");
  await press(page, m.notices);
  await expect(main.getByRole("link", { name: m.notices })).toHaveAttribute("aria-current", "page");
  await expect(main.getByText(`${m.reasons.copyright} · ${m.noticeStatus.open}`)).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  await press(page, TEXT.title);
  await expect(main.getByRole("heading", { level: 1, name: TEXT.title })).toBeVisible();
  await expect(main.getByText(TEXT.body)).toBeVisible();
  await expect(main.getByText("Lin Wei · lin@example.test")).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  await press(page, m.notice.removeText);
  await expect(main.getByText(m.statement.sourceNotice)).toBeVisible();
  await main.getByRole("combobox", { name: m.statement.ground }).selectOption("copyright");
  await main.getByRole("textbox", { name: m.statement.facts }).fill("Leçon 3 d'un manuel publié.");
  await main
    .getByRole("textbox", { name: m.statement.explanation })
    .fill("Reproduite sans l'accord de l'éditeur.");
  api.unsent = ["lin@example.test"];
  await press(page, m.statement.sendRemoved);
  await expect(main.getByRole("heading", { name: m.statement.sent })).toBeFocused();
  await expect(main.getByRole("alert")).toContainText("lin@example.test");
  expect(api.removed).toEqual([
    {
      ground: "copyright",
      facts: "Leçon 3 d'un manuel publié.",
      explanation: "Reproduite sans l'accord de l'éditeur.",
    },
  ]);
  expect(await accessibilityViolations(page)).toEqual([]);
});

test("keeps a reported text and answers the notifier", async ({ page }) => {
  const api = await fakeApi(page);
  await dataReady(page);
  const main = page.getByRole("main");
  await page.goto("/admin/notices/n1");
  await press(page, m.notice.keep);
  await press(page, m.notice.sendKeep);
  await expect(main.getByRole("alert")).toHaveText(m.failure.reply);
  await main.getByRole("textbox", { name: m.notice.reply }).fill("Courte citation, autorisée.");
  await press(page, m.notice.sendKeep);
  await expect(main.getByText(m.notice.sentKeptBody)).toBeVisible();
  expect(api.kept).toEqual([{ reply: "Courte citation, autorisée." }]);
});

test("deletes an account from the admin, after a confirmation", async ({ page }) => {
  const api = await fakeApi(page);
  await dataReady(page);
  const main = page.getByRole("main");
  await page.goto("/admin/accounts");
  await press(page, m.accounts.delete);
  await expect(main.getByRole("alert")).toHaveText(m.accounts.empty);

  await main.getByRole("textbox", { name: m.accounts.email }).fill("nobody@example.test");
  await press(page, m.accounts.delete);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: m.accounts.cancel })).toBeFocused();
  await dialog.getByRole("button", { name: m.accounts.confirm }).click();
  await expect(main.getByRole("alert")).toHaveText(m.accounts.notFound);

  await main.getByRole("textbox", { name: m.accounts.email }).fill("child@example.test");
  await press(page, m.accounts.delete);
  await expect(dialog).toHaveAccessibleName(
    m.accounts.confirmTitle.replace("{{email}}", "child@example.test"),
  );
  expect(await accessibilityViolations(page)).toEqual([]);
  await dialog.getByRole("button", { name: m.accounts.confirm }).click();
  await expect(
    main.getByRole("status").getByText("Account deleted: child@example.test"),
  ).toBeVisible();
  expect(api.deletedAccounts).toEqual(["child@example.test"]);
  expect(await accessibilityViolations(page)).toEqual([]);
});
