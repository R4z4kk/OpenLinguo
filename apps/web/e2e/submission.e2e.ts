import { LICENCES, NewSubmission, type Submission } from "@openlinguo/core/submission";
import { expect, type Page, type Route } from "@playwright/test";
import { authEn } from "../src/i18n/auth/en.ts";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";
import { put } from "./seed.ts";

const TEXT_ID = "00000000-0000-4000-8000-0000000002a3";
const STORY_ID = "00000000-0000-4000-8000-0000000002a4";
const provenance = {
  origin: "ai",
  provider: "groq",
  model: "llama-3.3-70b-versatile",
  promptVersion: "zh-story-v1",
  createdAt: "2026-10-30T09:00:00.000Z",
} as const;

// `vite preview` has no Functions: the API answers here, checking requests against the contract.
type FakeApi = {
  readonly sent: NewSubmission[];
  readonly stored: Submission[];
  signedIn: boolean;
  refusal: { readonly status: number; readonly code: string } | null;
};

const fakeApi = async (page: Page): Promise<FakeApi> => {
  const api: FakeApi = { sent: [], stored: [], signedIn: true, refusal: null };
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/auth/get-session") {
      await json(
        route,
        200,
        api.signedIn
          ? {
              session: {},
              user: {
                email: "lin@example.test",
                name: "",
                ageDeclaredAt: "2026-10-31T10:00:00.000Z",
              },
            }
          : null,
      );
      return;
    }
    if (api.refusal !== null) {
      await json(route, api.refusal.status, { code: api.refusal.code, message: "refused" });
      return;
    }
    if (pathname === "/api/submissions" && request.method() === "POST") {
      const parsed = NewSubmission.parse(request.postDataJSON());
      api.sent.push(parsed);
      const { attribution, ...draft } = parsed;
      const at = new Date().toISOString();
      const shared = {
        ...draft,
        id: `s${String(api.stored.length + 1)}`,
        attribution: attribution.kind === "pseudonym" ? attribution.name : null,
        status: "pending",
        attestedAt: at,
        createdAt: at,
      } as const;
      const created: Submission =
        shared.origin === "ai"
          ? { ...shared, licence: LICENCES.ai }
          : { ...shared, licence: LICENCES.human };
      api.stored.push(created);
      await json(route, 201, created);
      return;
    }
    if (pathname === "/api/submissions") {
      await json(route, 200, api.stored);
      return;
    }
    const withdrawn = /^\/api\/submissions\/(.+)$/u.exec(pathname)?.[1] ?? null;
    if (withdrawn !== null && request.method() === "DELETE") {
      api.stored.splice(
        api.stored.findIndex(({ id }) => id === withdrawn),
        1,
      );
      await route.fulfill({ status: 204 });
      return;
    }
    await json(route, 404, { code: "NOT_FOUND", message: pathname });
  });
  return api;
};

const seed = async (page: Page): Promise<void> => {
  await page.goto("/read");
  await expect(page.getByRole("main").getByText(en.library.emptyTitle)).toBeVisible({
    timeout: 90_000,
  });
  const text = { createdAt: Date.UTC(2026, 9, 31, 10), readingChoices: {} };
  await put(page, "texts", {
    ...text,
    id: TEXT_ID,
    title: "我的周末",
    body: "我周末去公园。",
    source: "paste",
    provenance: null,
  });
  await put(page, "texts", {
    ...text,
    id: STORY_ID,
    title: "小猫",
    body: "小猫很可爱。",
    source: "ai",
    provenance,
  });
};

const press = async (page: Page, name: string, key = "Enter"): Promise<void> => {
  await page
    .getByRole("main")
    .getByRole("link", { name })
    .or(page.getByRole("main").getByRole("button", { name }))
    .focus();
  await page.keyboard.press(key);
};

test.use({ serviceWorkers: "block" });

test("submits a learner's text with the keyboard, then withdraws it", async ({ page }) => {
  const api = await fakeApi(page);
  await seed(page);
  const main = page.getByRole("main");
  await page.goto(`/read/${TEXT_ID}`);
  await expect(main.getByRole("link", { name: en.submit.link })).toBeVisible({ timeout: 60_000 });
  await press(page, en.submit.link);
  await expect(main.getByRole("heading", { level: 1, name: en.submit.title })).toBeVisible();
  await expect(main.getByText(en.submit.human.name).first()).toBeVisible();
  await expect(main.getByText(en.submit.human.origin)).toBeVisible();
  await expect(main.getByRole("radio", { name: en.submit.anonymous })).toBeChecked();
  await expect(main.getByRole("group", { name: en.submit.signature })).toHaveAccessibleDescription(
    authEn.pseudonym.identity,
  );
  expect(await accessibilityViolations(page)).toEqual([]);

  await press(page, en.submit.send);
  const alert = main.getByRole("alert");
  await expect(alert).toHaveText(en.submit.failure.unticked);
  await expect(alert).toBeFocused();
  expect(api.sent).toEqual([]);

  for (const statement of ["author", "rights", "irrevocable"] as const) {
    await main.getByRole("checkbox", { name: en.submit.statement[statement] }).focus();
    await page.keyboard.press("Space");
  }
  await main.getByRole("radio", { name: en.submit.anonymous }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(main.getByRole("radio", { name: en.submit.pseudonym })).toBeChecked();
  await main.getByRole("textbox", { name: en.submit.pseudonymField }).focus();
  await page.keyboard.type("小明");
  await expect(main.getByText("By 小明")).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);

  await press(page, en.submit.send);
  const sent = main.getByRole("heading", { name: en.submit.sent });
  await expect(sent).toBeFocused();
  expect(api.sent).toEqual([
    {
      origin: "human",
      provenance: null,
      title: "我的周末",
      body: "我周末去公园。",
      attribution: { kind: "pseudonym", name: "小明" },
      attestationVersion: 1,
    },
  ]);

  await press(page, en.submit.mine);
  await expect(main.getByRole("heading", { level: 1, name: en.account.title })).toBeVisible();
  await expect(main.getByText(en.account.status.pending)).toBeVisible();
  expect(await accessibilityViolations(page)).toEqual([]);
  await press(page, `Withdraw the submission “我的周末”`);
  await expect(
    main.getByRole("status").getByText("Submission “我的周末” withdrawn."),
  ).toBeVisible();
  await expect(main.getByText(en.account.none)).toBeVisible();
  expect(api.stored).toEqual([]);
});

test("keeps a story's answers when the server refuses it", async ({ page }) => {
  const api = await fakeApi(page);
  await seed(page);
  const main = page.getByRole("main");
  await page.goto(`/read/${STORY_ID}/submit`);
  await expect(main.getByText(en.submit.ai.origin)).toBeVisible();
  await expect(main.getByText(en.submit.ai.name).first()).toBeVisible();
  await expect(main.getByText(`Generated by AI · ${provenance.model}`)).toBeVisible();
  await expect(main.getByRole("checkbox")).toHaveCount(2);
  for (const statement of ["generated", "noThirdParty"] as const) {
    await main.getByRole("checkbox", { name: en.submit.statement[statement] }).focus();
    await page.keyboard.press("Space");
  }
  api.refusal = { status: 409, code: "SUBMISSION_LIMIT" };
  await press(page, en.submit.send);
  const alert = main.getByRole("alert");
  await expect(alert).toHaveText(en.submit.failure.limit);
  await expect(alert).toBeFocused();
  for (const checkbox of await main.getByRole("checkbox").all())
    await expect(checkbox).toBeChecked();
  expect(await accessibilityViolations(page)).toEqual([]);

  api.refusal = null;
  await press(page, en.submit.send);
  await expect(main.getByRole("heading", { name: en.submit.sent })).toBeFocused();
  expect(api.sent).toMatchObject([
    { origin: "ai", provenance, attribution: { kind: "anonymous" } },
  ]);
});

test("asks for an account when signed out", async ({ page }) => {
  const api = await fakeApi(page);
  api.signedIn = false;
  await seed(page);
  await page.goto(`/read/${TEXT_ID}/submit`);
  const main = page.getByRole("main");
  await expect(main.getByText(en.submit.failure.signedOut)).toBeVisible();
  await expect(main.getByRole("button", { name: en.submit.send })).toHaveCount(0);
  expect(await accessibilityViolations(page)).toEqual([]);
});
