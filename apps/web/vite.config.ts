import { readFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type Rolldown } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { headersFor, parseHeaderRules } from "./src/build/security-headers.ts";
import { oversizedFiles, PAGES_FILE_LIMIT } from "./src/build/served-files.ts";
import {
  collectNotices,
  formatNotices,
  NOTICES_FILE,
  resolveWorkboxDirs,
  workboxPackagesOf,
} from "./src/build/third-party-notices.ts";

const rules = parseHeaderRules(readFileSync(new URL("public/_headers", import.meta.url), "utf8"));
if (!rules.ok) throw new Error(`public/_headers: ${rules.error}`);

/** `vite preview` sends each path the headers Pages would (`public/_headers`). */
const pagesHeaders = (): Plugin => ({
  name: "pages-headers",
  configurePreviewServer(server) {
    server.middlewares.use((request, response, next) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      for (const [name, value] of Object.entries(headersFor(rules.value, path))) {
        response.setHeader(name, value);
      }
      next();
    });
  },
});

/** Pages refuses to serve a file above its limit: the build fails instead. */
const pagesFileLimit = (): Plugin => {
  let outDir = "";
  return {
    name: "pages-file-limit",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const oversized = await oversizedFiles(outDir, PAGES_FILE_LIMIT);
      if (oversized.length > 0) {
        throw new Error(
          `files above the 25 MiB Pages limit: ${oversized.map(({ path, bytes }) => `${path} (${String(bytes)} bytes)`).join(", ")}`,
        );
      }
    },
  };
};

/**
 * Minification drops legal comments, so the licenses of the shipped code go to `NOTICES_FILE`:
 * the app's modules, its workers' (bundled first, during the app's build) and the Workbox runtime
 * vite-plugin-pwa writes when the bundle closes. Not precached, like the data's license texts.
 */
const thirdPartyNotices = (): { readonly app: Plugin; readonly worker: () => Plugin } => {
  const moduleIds = new Set<string>();
  const collect = (bundle: Rolldown.OutputBundle) => {
    for (const output of Object.values(bundle)) {
      if (output.type === "chunk") for (const id of output.moduleIds) moduleIds.add(id);
    }
  };
  let outDir = "";
  const app = fileURLToPath(new URL(".", import.meta.url));
  return {
    worker: () => ({
      name: "third-party-notices-worker",
      apply: "build",
      generateBundle(_, bundle) {
        collect(bundle);
      },
    }),
    app: {
      name: "third-party-notices",
      apply: "build",
      configResolved(config) {
        outDir = resolve(config.root, config.build.outDir);
      },
      generateBundle(_, bundle) {
        collect(bundle);
      },
      closeBundle: {
        order: "post",
        sequential: true,
        async handler() {
          const runtimes = (await readdir(outDir)).filter((name) => /^workbox-.*\.js$/u.test(name));
          const sources = await Promise.all(
            runtimes.map((name) => readFile(join(outDir, name), "utf8")),
          );
          const workbox = resolveWorkboxDirs(sources.flatMap(workboxPackagesOf), app);
          if (!workbox.ok) throw new Error(`third-party notices: ${workbox.error}`);
          const notices = await collectNotices({
            moduleIds,
            packageDirs: workbox.value,
            root: resolve(app, "../.."),
          });
          if (!notices.ok) throw new Error(`third-party notices: ${notices.error}`);
          const text = formatNotices(notices.value.packages, notices.value.ported);
          await writeFile(join(outDir, NOTICES_FILE), text, "utf8");
        },
      },
    },
  };
};
const notices = thirdPartyNotices();

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("src", import.meta.url)) } },
  worker: { format: "es", plugins: () => [notices.worker()] },
  plugins: [
    pagesHeaders(),
    pagesFileLimit(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "OpenLinguo",
        short_name: "OpenLinguo",
        description: "Learn Mandarin Chinese, offline first.",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#F6F7F5",
        theme_color: "#F6F7F5",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: [
          "**/*.{js,css,html,svg,png,webmanifest}",
          "**/atkinson-hyperlegible-next-latin-wght-normal-*.woff2",
          "**/{noto-sans-sc-400,lxgw-wenkai-gb}-{latin,punctuation,hsk-1,hsk-2}-*.woff2",
        ],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "font",
            handler: "CacheFirst",
            options: { cacheName: "fonts", expiration: { maxEntries: 200 } },
          },
        ],
        navigateFallback: "/index.html",
        // License texts (NOTICES_FILE, /data/licenses/) open as files, not as the app.
        navigateFallbackDenylist: [/\.txt$/u],
      },
    }),
    notices.app,
  ],
  // Inlined data: URIs would be blocked by the CSP (font-src and img-src 'self').
  build: { assetsInlineLimit: 0 },
});
