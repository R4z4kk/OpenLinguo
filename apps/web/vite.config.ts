import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { headersFor, parseHeaderRules } from "./src/build/security-headers.ts";
import { oversizedFiles, PAGES_FILE_LIMIT } from "./src/build/served-files.ts";

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

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("src", import.meta.url)) } },
  worker: { format: "es" },
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
      },
    }),
  ],
  // Inlined data: URIs would be blocked by the CSP (font-src and img-src 'self').
  build: { assetsInlineLimit: 0 },
});
