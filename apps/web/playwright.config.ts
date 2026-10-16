import { defineConfig, devices } from "@playwright/test";

const ci = process.env["CI"] === "true";

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  // Every test has its own server and browser context, so CI shards split by test.
  fullyParallel: true,
  // A first visit imports the whole offline dictionary.
  timeout: 120_000,
  forbidOnly: ci,
  reporter: ci ? [["github"], ["html", { open: "never" }]] : "list",
  use: { locale: "en-US", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    { name: "webkit", use: devices["Desktop Safari"] },
  ],
});
