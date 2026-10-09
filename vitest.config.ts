import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*", "tools/*"],
    coverage: {
      provider: "v8",
      include: ["apps/*/src/**", "packages/*/src/**", "tools/*/src/**"],
      reporter: ["text", "lcov"],
    },
  },
});
