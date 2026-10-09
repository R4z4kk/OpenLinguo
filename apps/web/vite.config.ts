import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { parseHeaders } from "./src/build/security-headers.ts";

const headers = parseHeaders(readFileSync(new URL("public/_headers", import.meta.url), "utf8"));
if (!headers.ok) throw new Error(`public/_headers: ${headers.error}`);

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("src", import.meta.url)) } },
  plugins: [
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
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        navigateFallback: "/index.html",
      },
    }),
  ],
  preview: { headers: headers.value },
});
