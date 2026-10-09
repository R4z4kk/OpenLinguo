import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "tools/*"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "tools/*/src/**"],
      reporter: ["text", "lcov"],
    },
  },
});
