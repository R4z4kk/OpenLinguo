import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base } from "@playwright/test";
import { preview } from "vite";

export type Server = {
  readonly url: string;
  /** Stops the server: the page is left with its service worker and IndexedDB. */
  readonly goOffline: () => Promise<void>;
};

/** A browser profile holding the imported offline data, on `port` only: IndexedDB is per origin. */
type Profile = { readonly dir: string; readonly port: number };

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "localhost", () => {
      const address = probe.address();
      probe.close(() => {
        if (address !== null && typeof address === "object") resolve(address.port);
        else reject(new Error("no free port for vite preview"));
      });
    });
  });

const startServer = async (port: number): Promise<Server> => {
  const server = await preview({
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "warn",
    preview: { port, strictPort: true },
  });
  let running = true;
  const stop = async (): Promise<void> => {
    if (!running) return;
    running = false;
    await server.close();
  };
  const url = server.resolvedUrls?.local[0];
  if (url == null) {
    await stop();
    throw new Error("vite preview has no local URL");
  }
  return { url, goOffline: stop };
};

const temporaryDir = (name: string): Promise<string> =>
  mkdtemp(join(tmpdir(), `openlinguo-e2e-${name}-`));

/**
 * Each test gets its own `vite preview` of `dist` (built beforehand) with the `_headers` CSP, and its
 * own browser profile: a copy of the one where its worker imported the offline data, or an empty one
 * with `seeded: false`. Offline is a stopped server: WebKit's emulated offline also fails service
 * worker responses. `serviceWorkers: "block"` keeps the page's requests in `page.route` in WebKit.
 */
export const test = base.extend<{ server: Server; seeded: boolean }, { profile: Profile }>({
  seeded: [true, { option: true }],
  profile: [
    async ({ playwright, browserName }, use) => {
      const port = await freePort();
      const dir = await temporaryDir("template");
      try {
        const server = await startServer(port);
        try {
          const context = await playwright[browserName].launchPersistentContext(dir);
          try {
            const page = await context.newPage();
            await page.goto(new URL("/learn/dictionary", server.url).href);
            // Worker fixtures get no test options: the page is in the system language.
            const failure = page.getByRole("alert");
            await expect(page.getByRole("searchbox").or(failure)).toBeVisible({ timeout: 110_000 });
            if (await failure.isVisible()) {
              throw new Error(`offline data import failed: ${await failure.innerText()}`);
            }
            // Each test installs the service worker itself.
            await page.evaluate(async () => {
              await (await navigator.serviceWorker.ready).unregister();
              for (const key of await caches.keys()) await caches.delete(key);
            });
          } finally {
            await context.close();
          }
        } finally {
          await server.goOffline();
        }
        await use({ dir, port });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],
  server: async ({ profile }, use) => {
    const server = await startServer(profile.port);
    await use(server);
    await server.goOffline();
  },
  baseURL: async ({ server }, use) => {
    await use(server.url);
  },
  context: async ({ playwright, browserName, seeded, profile, serviceWorkers }, use) => {
    const dir = await temporaryDir("profile");
    try {
      if (seeded) await cp(profile.dir, dir, { recursive: true });
      const context = await playwright[browserName].launchPersistentContext(dir, {
        serviceWorkers,
      });
      try {
        await use(context);
      } finally {
        await context.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
});
