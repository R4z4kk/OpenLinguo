import type { ApiError } from "@openlinguo/core/api-error";
import { type StoredChunk, SYNC_HEADERS, SYNC_LIMITS } from "@openlinguo/core/sync";
import { expect, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authEn } from "../src/i18n/auth/en.ts";
import { en } from "../src/i18n/en.ts";
import { accessibilityViolations } from "./accessibility.ts";
import { test } from "./app.ts";
import { all } from "./seed.ts";

const USER = {
  id: "user-lin",
  email: "lin@example.test",
  name: "",
  role: null,
  ageDeclaredAt: "2026-10-31T10:00:00.000Z",
  twoFactorEnabled: false,
};

type Chunk = { readonly id: number; readonly bytes: Buffer };

// `vite preview` has no Functions: one store answers both devices, as the sync routes would.
type FakeApi = { readonly chunks: Chunk[]; nextId: number; reads: number };

const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
  route.fulfill({
    status,
    headers,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

const refuse = (route: Route, status: number, code: ApiError["code"]) =>
  json(route, status, { code, message: code } satisfies ApiError);

const serveSync = async (api: FakeApi, route: Route): Promise<void> => {
  const request = route.request();
  const used = api.chunks.reduce((sum, { bytes }) => sum + bytes.length, 0);
  const oldest = api.chunks[0]?.id ?? null;
  switch (request.method()) {
    case "POST": {
      const body = request.postDataBuffer();
      if (body === null || body[0] !== 0x1f || body[1] !== 0x8b) {
        await refuse(route, 400, "INVALID_REQUEST");
        return;
      }
      if (body.length > SYNC_LIMITS.chunkBytes) {
        await refuse(route, 413, "SYNC_CHUNK_TOO_LARGE");
        return;
      }
      const expected = request.headers()[SYNC_HEADERS.expectedOldest] ?? null;
      if (expected !== null && Number(expected) !== oldest) {
        await refuse(route, 409, "SYNC_STORE_CHANGED");
        return;
      }
      if (used + body.length > SYNC_LIMITS.accountBytes) {
        await refuse(route, 409, "SYNC_QUOTA");
        return;
      }
      api.nextId += 1;
      api.chunks.push({ id: api.nextId, bytes: body });
      await json(route, 201, {
        id: api.nextId,
        used: used + body.length,
        limit: SYNC_LIMITS.accountBytes,
        oldest: oldest ?? api.nextId,
      } satisfies StoredChunk);
      return;
    }
    case "GET": {
      api.reads += 1;
      const after = Number(new URL(request.url()).searchParams.get("after"));
      const chunk = api.chunks.find(({ id }) => id > after) ?? null;
      const headers: Record<string, string> = { [SYNC_HEADERS.used]: String(used) };
      if (oldest !== null) headers[SYNC_HEADERS.oldest] = String(oldest);
      if (chunk === null) {
        await route.fulfill({ status: 204, headers });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { ...headers, [SYNC_HEADERS.id]: String(chunk.id) },
        contentType: "application/gzip",
        body: chunk.bytes,
      });
      return;
    }
    case "DELETE":
      api.chunks.length = 0;
      await route.fulfill({ status: 204 });
      return;
    default:
      await refuse(route, 404, "NOT_FOUND");
  }
};

const fakeApi = async (...contexts: readonly BrowserContext[]): Promise<FakeApi> => {
  const api: FakeApi = { chunks: [], nextId: 0, reads: 0 };
  for (const context of contexts) {
    await context.route("**/api/**", async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname.startsWith("/api/sync/chunks")) {
        await serveSync(api, route);
        return;
      }
      switch (pathname) {
        case "/api/auth/get-session":
          await json(route, 200, { session: { twoFactorVerifiedAt: null }, user: USER });
          return;
        case "/api/auth/list-accounts":
        case "/api/submissions":
          await json(route, 200, []);
          return;
        default:
          await refuse(route, 404, "NOT_FOUND");
      }
    });
  }
  return api;
};

/** A second device: the browser profile the first one started from, with its own storage. */
const secondDevice = async (
  launch: (dir: string) => Promise<BrowserContext>,
  template: string,
  use: (device: BrowserContext) => Promise<void>,
): Promise<void> => {
  const dir = await mkdtemp(join(tmpdir(), "openlinguo-e2e-device-"));
  try {
    await cp(template, dir, { recursive: true });
    const device = await launch(dir);
    try {
      await use(device);
    } finally {
      await device.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const mainOf = (page: Page): Locator => page.getByRole("main");

const syncOf = (page: Page): Locator =>
  mainOf(page).getByRole("region", { name: authEn.sync.title });

const press = async (target: Locator, key = "Enter"): Promise<void> => {
  await target.focus();
  await target.page().keyboard.press(key);
};

const noViolations = async (page: Page) => {
  expect(await accessibilityViolations(page)).toEqual([]);
};

const lastSyncToday = new RegExp(
  `^${authEn.sync.lastToday.slice(0, authEn.sync.lastToday.indexOf("{{")).replace(/\./gu, "\\.")}`,
  "u",
);

const openSync = async (page: Page): Promise<void> => {
  await page.goto("/profile/account");
  await expect(syncOf(page).getByRole("heading", { name: authEn.sync.title })).toBeVisible({
    timeout: 90_000,
  });
};

const turnOn = async (page: Page): Promise<void> => {
  await openSync(page);
  await expect(syncOf(page).getByText(authEn.sync.intro)).toBeVisible();
  await noViolations(page);
  await press(syncOf(page).getByRole("button", { name: authEn.sync.activate }));
  await expect(syncOf(page).getByRole("status")).toHaveText(lastSyncToday);
  await expect(syncOf(page).getByText(/^Space used: /u)).toBeVisible();
  await noViolations(page);
};

/** The section's « Sync now », waited for by the store being read and the status settling. */
const syncNow = async (page: Page, api: FakeApi): Promise<void> => {
  await openSync(page);
  const status = syncOf(page).getByRole("status");
  await expect(status).toHaveText(/^On\./u);
  const before = api.reads;
  await press(syncOf(page).getByRole("button", { name: authEn.sync.syncNow }));
  await expect.poll(() => api.reads).toBeGreaterThan(before);
  await expect(status).toHaveText(lastSyncToday);
  await noViolations(page);
};

const myWords = (page: Page): Locator =>
  mainOf(page).getByRole("checkbox", { name: en.decks.myWords });

const openWord = async (page: Page): Promise<Locator> => {
  await page.goto("/learn/dictionary/你好");
  const checkbox = myWords(page);
  await expect(checkbox).toBeEnabled({ timeout: 90_000 });
  return checkbox;
};

test.use({ serviceWorkers: "block" });

test("two devices converge", async ({
  page,
  context,
  playwright,
  browserName,
  server,
  profile,
}) => {
  await secondDevice(
    (dir) =>
      playwright[browserName].launchPersistentContext(dir, {
        serviceWorkers: "block",
        baseURL: server.url,
      }),
    profile.dir,
    async (deviceContext) => {
      const api = await fakeApi(context, deviceContext);
      const other = deviceContext.pages()[0] ?? (await deviceContext.newPage());
      await other.bringToFront();

      await turnOn(page);
      await turnOn(other);

      await expect(await openWord(page)).not.toBeChecked();
      await press(myWords(page), "Space");
      await expect(myWords(page)).toBeChecked();
      await syncNow(page, api);

      await syncNow(other, api);
      await expect(await openWord(other)).toBeChecked();
      expect(await all(other, "deckWords")).toHaveLength(1);

      await other.getByRole("link", { name: en.nav.today }).focus();
      await other.keyboard.press("Enter");
      await expect(mainOf(other)).toContainText(
        en.today.goalCount.replace("{{done}}", "0").replace("{{goal}}", "20"),
      );
      await press(mainOf(other).getByRole("link", { name: en.today.start }));
      const focused = other.locator(":focus");
      await expect(focused).toContainText("你好");
      await other.keyboard.press("Space");
      await expect(focused).toContainText("hello; hi");
      await other.keyboard.press("4");
      await expect(
        mainOf(other).getByRole("progressbar", { name: en.review.progress }),
      ).toHaveAttribute("value", "1");
      const reviews = await all(other, "reviews");
      expect(reviews).toHaveLength(1);
      await syncNow(other, api);

      await syncNow(page, api);
      expect(await all(page, "reviews")).toEqual(reviews);
      expect(await all(page, "cards")).toEqual(await all(other, "cards"));
      await page.getByRole("link", { name: en.nav.today }).focus();
      await page.keyboard.press("Enter");
      await expect(mainOf(page)).toContainText(
        en.today.goalCount.replace("{{done}}", "1").replace("{{goal}}", "20"),
      );

      await expect(await openWord(page)).toBeChecked();
      await press(myWords(page), "Space");
      await expect(myWords(page)).not.toBeChecked();
      await syncNow(page, api);

      await syncNow(other, api);
      await expect(await openWord(other)).not.toBeChecked();
      expect(await all(other, "deckWords")).toHaveLength(0);
      expect(await all(other, "reviews")).toEqual(reviews);

      await openSync(page);
      await press(syncOf(page).getByRole("button", { name: authEn.sync.turnOff }));
      const dialog = page.getByRole("dialog", { name: authEn.sync.offTitle });
      await expect(dialog.getByRole("button", { name: authEn.sync.offCancel })).toBeFocused();
      await noViolations(page);
      await page.keyboard.press("Tab");
      await expect(dialog.getByRole("button", { name: authEn.sync.offConfirm })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(dialog).toBeHidden();
      await expect(syncOf(page).getByRole("heading", { name: authEn.sync.title })).toBeFocused();
      await expect(syncOf(page).getByRole("button", { name: authEn.sync.activate })).toBeVisible();
      expect(api.chunks).toHaveLength(0);
      await noViolations(page);

      await openSync(other);
      const before = api.reads;
      await press(syncOf(other).getByRole("button", { name: authEn.sync.syncNow }));
      await expect.poll(() => api.reads).toBeGreaterThan(before);
      await expect(syncOf(other).getByRole("alert")).toHaveText(
        authEn.sync.failure.turnedOffElsewhere,
      );
      await noViolations(other);
      await press(syncOf(other).getByRole("button", { name: authEn.sync.activate }));
      await expect(syncOf(other).getByRole("alert")).toHaveCount(0);
      await expect.poll(() => api.chunks.length).toBeGreaterThan(0);
      await expect(syncOf(other).getByRole("status")).toHaveText(lastSyncToday);
    },
  );
});
