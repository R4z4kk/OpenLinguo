import { fileURLToPath } from "node:url";
import { test as base } from "@playwright/test";
import { preview } from "vite";

export type Server = {
  readonly url: string;
  /** Stops the server: the page is left with its service worker and IndexedDB. */
  readonly goOffline: () => Promise<void>;
};

/**
 * Each test gets its own `vite preview` of `dist` (built beforehand) with the `_headers` CSP.
 * Offline is a stopped server: WebKit's emulated offline also fails service worker responses.
 */
export const test = base.extend<{ server: Server }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright reads fixture dependencies from this pattern.
  server: async ({}, use) => {
    const server = await preview({
      root: fileURLToPath(new URL("..", import.meta.url)),
      logLevel: "warn",
      preview: { port: 0, strictPort: true },
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
    await use({ url, goOffline: stop });
    await stop();
  },
  baseURL: async ({ server }, use) => {
    await use(server.url);
  },
});
