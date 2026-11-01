import {
  AccountDeletion,
  type AccountExport,
  AgeDeclaration,
  type PublishedChoice,
  PseudonymUpdate,
} from "@openlinguo/core/account";
import { LICENCES, type Submission } from "@openlinguo/core/submission";
import { expect, type Page, type Route } from "@playwright/test";
import { z } from "zod";
import { authEn } from "../src/i18n/auth/en.ts";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";

const CODE = "246810";
const TOTP = "135790";
const BACKUP = "abcde-12345";
const TOTP_URI =
  "otpauth://totp/OpenLinguo:lin%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=OpenLinguo";

type User = {
  email: string;
  name: string;
  role: "admin" | null;
  ageDeclaredAt: string | null;
  twoFactorEnabled: boolean;
  providers: string[];
};

// `vite preview` has no Functions: the API answers here, with Better Auth's shapes and codes.
type FakeApi = {
  readonly users: Map<string, User>;
  current: { email: string; verified: boolean } | null;
  signupsOpen: boolean;
  expired: boolean;
  offline: boolean;
  readonly codesSentTo: string[];
  readonly submissions: Submission[];
  deletedWith: PublishedChoice | null;
};

const user = (email: string, rest: Partial<User>): User => ({
  email,
  name: "",
  role: null,
  ageDeclaredAt: "2026-10-31T10:00:00.000Z",
  twoFactorEnabled: false,
  providers: [],
  ...rest,
});

const fakeApi = async (page: Page): Promise<FakeApi> => {
  const api: FakeApi = {
    users: new Map(),
    current: null,
    signupsOpen: true,
    expired: false,
    offline: false,
    codesSentTo: [],
    submissions: [],
    deletedWith: null,
  };
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const refuse = (route: Route, status: number, code: string) =>
    json(route, status, { code, message: code });
  const signIn = (email: string, provider: string | null) => {
    const known = api.users.get(email) ?? user(email, { ageDeclaredAt: null });
    if (provider !== null && !known.providers.includes(provider)) known.providers.push(provider);
    api.users.set(email, known);
    api.current = { email, verified: false };
  };

  await page.route("**/api/**", async (route) => {
    if (api.offline) {
      await route.abort("internetdisconnected");
      return;
    }
    const request = route.request();
    const { pathname } = new URL(request.url());
    const body: unknown = request.method() === "POST" ? request.postDataJSON() : null;
    const current = api.current === null ? null : (api.users.get(api.current.email) ?? null);
    switch (pathname) {
      case "/api/auth/get-session":
        await json(
          route,
          200,
          current === null || api.current === null
            ? null
            : {
                session: {
                  twoFactorVerifiedAt: api.current.verified ? new Date().toISOString() : null,
                },
                user: current,
              },
        );
        return;
      case "/api/auth/email-otp/send-verification-otp": {
        const { email } = z.object({ email: z.string() }).parse(body);
        if (!api.users.has(email) && !api.signupsOpen) {
          await refuse(route, 403, "SIGNUPS_CLOSED");
          return;
        }
        api.codesSentTo.push(email);
        await json(route, 200, { success: true });
        return;
      }
      case "/api/auth/sign-in/email-otp": {
        const { email, otp } = z.object({ email: z.string(), otp: z.string() }).parse(body);
        if (api.expired) {
          await refuse(route, 400, "OTP_EXPIRED");
          return;
        }
        if (otp !== CODE) {
          await refuse(route, 400, "INVALID_OTP");
          return;
        }
        signIn(email, null);
        await json(route, 200, { token: "t" });
        return;
      }
      case "/api/auth/sign-in/social": {
        const { provider, callbackURL } = z
          .object({ provider: z.string(), callbackURL: z.string() })
          .parse(body);
        // Stands for the provider's page and Better Auth's callback, which sets the cookie.
        signIn(`${provider}@example.test`, provider);
        await json(route, 200, { url: new URL(callbackURL, request.url()).href, redirect: true });
        return;
      }
      case "/api/account/age": {
        const { answer } = AgeDeclaration.parse(body);
        if (current === null) {
          await refuse(route, 401, "UNAUTHORIZED");
          return;
        }
        if (answer === "under-15") {
          api.users.delete(current.email);
          api.current = null;
          await json(route, 200, { success: true });
          return;
        }
        current.ageDeclaredAt = new Date().toISOString();
        await route.fulfill({ status: 204 });
        return;
      }
      case "/api/auth/sign-out":
        api.current = null;
        await json(route, 200, { success: true });
        return;
      case "/api/auth/list-accounts":
        await json(
          route,
          200,
          (current?.providers ?? []).map((providerId) => ({ providerId })),
        );
        return;
      case "/api/auth/update-user":
        if (current !== null) current.name = PseudonymUpdate.parse(body).name;
        await json(route, 200, { status: true });
        return;
      case "/api/auth/two-factor/enable":
        await json(route, 200, {
          totpURI: TOTP_URI,
          backupCodes: [BACKUP, "fghij-67890"],
        });
        return;
      case "/api/auth/two-factor/verify-totp":
      case "/api/auth/two-factor/verify-backup-code": {
        const { code } = z.object({ code: z.string() }).parse(body);
        const backup = pathname.endsWith("backup-code");
        if (code !== (backup ? BACKUP : TOTP) || current === null || api.current === null) {
          await refuse(route, 401, backup ? "INVALID_BACKUP_CODE" : "INVALID_CODE");
          return;
        }
        current.twoFactorEnabled = true;
        api.current.verified = true;
        await json(route, 200, { token: "t" });
        return;
      }
      case "/api/submissions":
        await json(route, 200, api.submissions);
        return;
      case "/api/account/export": {
        if (current === null) {
          await refuse(route, 401, "UNAUTHORIZED");
          return;
        }
        const at = new Date().toISOString();
        const exported: AccountExport = {
          exportedAt: at,
          account: {
            id: "u1",
            email: current.email,
            pseudonym: current.name === "" ? null : current.name,
            createdAt: at,
            ageDeclaredAt: current.ageDeclaredAt,
            role: current.role,
            twoFactorEnabled: current.twoFactorEnabled,
            activeAt: at,
            inactivityNoticeAt: null,
          },
          signInMethods: [],
          sessions: [],
          submissions: api.submissions,
          decisions: [],
          securityEvents: [],
        };
        await json(route, 200, exported);
        return;
      }
      case "/api/account/delete":
        if (current === null) {
          await refuse(route, 401, "UNAUTHORIZED");
          return;
        }
        api.deletedWith = AccountDeletion.parse(body).published;
        api.users.delete(current.email);
        api.current = null;
        await route.fulfill({ status: 204 });
        return;
      default:
        await refuse(route, 404, "NOT_FOUND");
    }
  });
  return api;
};

const press = async (page: Page, name: string, key = "Enter"): Promise<void> => {
  const main = page.getByRole("main");
  await main.getByRole("link", { name }).or(main.getByRole("button", { name })).focus();
  await page.keyboard.press(key);
};

const typeInto = async (page: Page, name: string, text: string): Promise<void> => {
  const field = page.getByRole("main").getByRole("textbox", { name });
  await field.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
};

const noViolations = async (page: Page) => {
  expect(await accessibilityViolations(page)).toEqual([]);
};

test.use({ serviceWorkers: "block" });

test("signs in with an email code and the age step, then signs out, with the keyboard", async ({
  page,
}) => {
  const api = await fakeApi(page);
  const main = page.getByRole("main");
  await page.goto("/profile/account");
  await expect(main.getByText(authEn.signedOut)).toBeVisible({ timeout: 90_000 });
  await noViolations(page);

  await press(page, authEn.signIn);
  await expect(main.getByRole("heading", { level: 1, name: authEn.signIn })).toBeVisible();
  const email = main.getByRole("textbox", { name: authEn.email });
  await expect(email).toBeFocused();
  await expect(main.getByRole("button", { name: authEn.google })).toBeVisible();
  await expect(main.getByRole("button", { name: authEn.github })).toBeVisible();
  await noViolations(page);

  await page.keyboard.type("lin@");
  await page.keyboard.press("Enter");
  await expect(main.getByText(authEn.emailInvalid)).toBeVisible();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await page.keyboard.type("example.test");
  await page.keyboard.press("Enter");

  const code = main.getByRole("textbox", { name: authEn.code });
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute("autocomplete", "one-time-code");
  await expect(code).toHaveAttribute("inputmode", "numeric");
  await expect(main.getByText("We sent a code to lin@example.test.")).toBeVisible();
  expect(api.codesSentTo).toEqual(["lin@example.test"]);
  await noViolations(page);

  await page.keyboard.type("111111");
  await page.keyboard.press("Enter");
  await expect(main.getByText("Wrong code. 2 attempts left.")).toBeVisible();
  await expect(code).toBeFocused();
  await noViolations(page);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(CODE);
  await page.keyboard.press("Enter");

  const age = main.getByRole("heading", { name: authEn.age.title });
  await expect(age).toBeFocused();
  await expect(main.getByRole("button", { name: authEn.age.over })).toHaveAccessibleDescription(
    authEn.age.overLine,
  );
  await noViolations(page);
  await press(page, authEn.age.over);

  await expect(page).toHaveURL(/\/profile\/account$/u);
  await expect(
    main.getByText("Signed in as lin@example.test. You can sign in with an email code."),
  ).toBeVisible();
  await expect(main.getByText(authEn.pseudonym.none)).toBeVisible();
  await expect(main.getByText(authEn.twoFactor.off)).toBeVisible();
  await expect(main.getByText(en.account.none)).toBeVisible();
  await noViolations(page);

  await press(page, authEn.signOut);
  await expect(main.getByRole("status").getByText(authEn.signedOutNow)).toBeVisible();
  expect(api.current).toBeNull();
});

test("deletes the account at once for « under 15 »", async ({ page }) => {
  const api = await fakeApi(page);
  const main = page.getByRole("main");
  await page.goto("/account/sign-in");
  await expect(main.getByRole("textbox", { name: authEn.email })).toBeFocused({ timeout: 90_000 });
  await page.keyboard.type("young@example.test");
  await page.keyboard.press("Enter");
  await expect(main.getByRole("textbox", { name: authEn.code })).toBeFocused();
  await page.keyboard.type(CODE);
  await page.keyboard.press("Enter");
  await expect(main.getByRole("heading", { name: authEn.age.title })).toBeFocused();
  await press(page, authEn.age.under);
  await expect(main.getByRole("heading", { name: authEn.age.deletedTitle })).toBeFocused();
  await expect(main.getByText(authEn.age.deletedBody)).toBeVisible();
  expect(api.users.size).toBe(0);
  expect(api.current).toBeNull();
  await noViolations(page);
});

test("says sign-ups are closed, from the address or from the provider", async ({ page }) => {
  const api = await fakeApi(page);
  api.signupsOpen = false;
  const main = page.getByRole("main");
  await page.goto("/account/sign-in");
  await expect(main.getByRole("textbox", { name: authEn.email })).toBeFocused({ timeout: 90_000 });
  await page.keyboard.type("new@example.test");
  await page.keyboard.press("Enter");
  const closed = main.getByRole("heading", { name: authEn.closedTitle });
  await expect(closed).toBeFocused();
  await expect(main.getByText(authEn.closedBody)).toBeVisible();
  await noViolations(page);

  await page.goto("/account/sign-in?error=SIGNUPS_CLOSED");
  await expect(closed).toBeFocused();
});

test("offers a new code once a code has expired, and says when it is offline", async ({ page }) => {
  const api = await fakeApi(page);
  api.users.set("lin@example.test", user("lin@example.test", {}));
  const main = page.getByRole("main");
  await page.goto("/account/sign-in");
  await expect(main.getByRole("textbox", { name: authEn.email })).toBeFocused({ timeout: 90_000 });
  await page.keyboard.type("lin@example.test");
  await page.keyboard.press("Enter");
  await expect(main.getByRole("textbox", { name: authEn.code })).toBeFocused();
  api.expired = true;
  await page.keyboard.type(CODE);
  await page.keyboard.press("Enter");
  const alert = main.getByRole("alert");
  await expect(alert).toHaveText(authEn.codeExpired);
  await expect(alert).toBeFocused();
  await expect(main.getByRole("textbox", { name: authEn.code })).toHaveCount(0);
  await noViolations(page);

  api.expired = false;
  await press(page, authEn.newCode);
  await expect(main.getByRole("textbox", { name: authEn.code })).toBeFocused();
  await expect(main.getByText("A new code was sent to lin@example.test.")).toBeVisible();
  expect(api.codesSentTo).toEqual(["lin@example.test", "lin@example.test"]);

  api.offline = true;
  await press(page, authEn.resend);
  await expect(alert).toHaveText(authEn.failure.offline);
  await expect(alert).toBeFocused();
});

test("comes back from GitHub to the age step, then to the return address", async ({ page }) => {
  const api = await fakeApi(page);
  const main = page.getByRole("main");
  await page.goto("/account/sign-in?return=%2Fprofile%2Faccount");
  await expect(main.getByRole("textbox", { name: authEn.email })).toBeFocused({ timeout: 90_000 });
  await press(page, authEn.github);
  await expect(main.getByRole("heading", { name: authEn.age.title })).toBeFocused();
  await press(page, authEn.age.over);
  await expect(page).toHaveURL(/\/profile\/account$/u);
  await expect(
    main.getByText(
      "Signed in as github@example.test. You can sign in with an email code or GitHub.",
    ),
  ).toBeVisible();
  expect(api.users.get("github@example.test")?.name).toBe("");
});

test("rectifies the pseudonym", async ({ page }) => {
  const api = await fakeApi(page);
  api.users.set("lin@example.test", user("lin@example.test", { name: "小明" }));
  api.current = { email: "lin@example.test", verified: false };
  const main = page.getByRole("main");
  await page.goto("/profile/account");
  const field = main.getByRole("textbox", { name: authEn.pseudonym.field });
  await expect(field).toHaveValue("小明", { timeout: 90_000 });
  await typeInto(page, authEn.pseudonym.field, "Lin");
  await press(page, authEn.pseudonym.save);
  await expect(main.getByRole("status").getByText(authEn.pseudonym.saved)).toBeVisible();
  expect(api.users.get("lin@example.test")?.name).toBe("Lin");
  await noViolations(page);
});

test("sets up the admin's authenticator, then asks every new session for it", async ({ page }) => {
  const api = await fakeApi(page);
  api.users.set("admin@example.test", user("admin@example.test", { role: "admin" }));
  api.current = { email: "admin@example.test", verified: false };
  const main = page.getByRole("main");
  await page.goto("/profile/account");
  await expect(main.getByText(authEn.twoFactor.required)).toBeVisible({ timeout: 90_000 });
  await press(page, authEn.twoFactor.enable);

  await expect(main.getByText(authEn.twoFactor.step1)).toBeFocused();
  await expect(main.getByRole("img", { name: authEn.twoFactor.qr })).toBeVisible();
  await expect(main.getByText("JBSW Y3DP EHPK 3PXP")).toBeVisible();
  await noViolations(page);

  await main.getByRole("textbox", { name: authEn.twoFactor.code }).focus();
  await page.keyboard.type("000000");
  await page.keyboard.press("Enter");
  await expect(main.getByText(authEn.twoFactor.wrong)).toBeVisible();
  await typeInto(page, authEn.twoFactor.code, TOTP);
  await page.keyboard.press("Enter");

  await expect(main.getByRole("heading", { name: authEn.twoFactor.backupTitle })).toBeFocused();
  await expect(main.getByText(BACKUP)).toBeVisible();
  const done = main.getByRole("button", { name: authEn.twoFactor.done });
  await expect(done).toHaveAttribute("aria-disabled", "true");
  await noViolations(page);
  await press(page, authEn.twoFactor.done);
  await expect(main.getByText(authEn.twoFactor.storeFirst)).toBeVisible();
  await main.getByRole("checkbox", { name: authEn.twoFactor.stored }).focus();
  await page.keyboard.press("Space");
  await press(page, authEn.twoFactor.done);
  await expect(main.getByText(authEn.twoFactor.on)).toBeVisible();

  api.current = { email: "admin@example.test", verified: false };
  await page.reload();
  const code = main.getByRole("textbox", { name: authEn.twoFactor.code });
  await expect(code).toBeFocused({ timeout: 90_000 });
  await noViolations(page);
  await page.keyboard.type("000000");
  await page.keyboard.press("Enter");
  await expect(main.getByText(authEn.twoFactor.wrong)).toBeVisible();
  await press(page, authEn.twoFactor.useBackup);
  const backup = main.getByRole("textbox", { name: authEn.twoFactor.backupCode });
  await expect(backup).toBeFocused();
  await page.keyboard.type(BACKUP);
  await page.keyboard.press("Enter");
  await expect(main.getByText(authEn.twoFactor.on)).toBeVisible();
  expect(api.current.verified).toBe(true);
});

test("downloads the account data, then deletes the account and keeps its texts", async ({
  page,
}) => {
  const api = await fakeApi(page);
  api.users.set("lin@example.test", user("lin@example.test", { name: "小明" }));
  api.current = { email: "lin@example.test", verified: false };
  api.submissions.push({
    id: "s1",
    title: "我的周末",
    body: "我周末去公园。",
    origin: "human",
    provenance: null,
    licence: LICENCES.human,
    attribution: "小明",
    status: "approved",
    attestationVersion: 1,
    attestedAt: "2026-10-31T10:00:00.000Z",
    createdAt: "2026-10-31T10:00:00.000Z",
  });
  const main = page.getByRole("main");
  await page.goto("/profile/account");
  await expect(main.getByRole("heading", { name: authEn.data.title })).toBeVisible({
    timeout: 90_000,
  });
  const saved = page.waitForEvent("download");
  await press(page, authEn.data.download);
  expect((await saved).suggestedFilename()).toMatch(
    /^openlinguo-account-\d{4}-\d{2}-\d{2}\.json$/u,
  );
  await expect(main.getByRole("status").getByText(/^File saved: /u)).toBeVisible();
  await noViolations(page);

  await press(page, authEn.deletion.open);
  const dialog = page.getByRole("dialog", { name: authEn.deletion.dialogTitle });
  await expect(dialog.getByRole("button", { name: authEn.deletion.cancel })).toBeFocused();
  await expect(
    dialog.getByRole("radio", { name: authEn.deletion.choices["keep-anonymous"] }),
  ).toBeChecked();
  await expect(dialog.getByText(authEn.deletion.keptTitle)).toBeVisible();
  await noViolations(page);

  await dialog.getByRole("radio", { name: authEn.deletion.choices["keep-named"] }).check();
  await dialog.getByRole("button", { name: authEn.deletion.confirm }).click();
  await expect(main.getByRole("heading", { name: authEn.deletion.doneTitle })).toBeFocused();
  expect(api.deletedWith).toBe("keep-named");
  expect(api.users.has("lin@example.test")).toBe(false);
  await noViolations(page);
});

test("asks nothing about published texts for an account without any", async ({ page }) => {
  const api = await fakeApi(page);
  api.users.set("lin@example.test", user("lin@example.test", {}));
  api.current = { email: "lin@example.test", verified: false };
  const main = page.getByRole("main");
  await page.goto("/profile/account");
  await expect(main.getByRole("heading", { name: authEn.deletion.title })).toBeVisible({
    timeout: 90_000,
  });
  await press(page, authEn.deletion.open);
  const dialog = page.getByRole("dialog", { name: authEn.deletion.dialogTitle });
  await expect(dialog.getByText(authEn.deletion.copies)).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(0);
  await press(page, authEn.deletion.cancel);
  await expect(dialog).toBeHidden();
  expect(api.deletedWith).toBeNull();
});
