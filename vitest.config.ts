import { playwright } from "@vitest/browser-playwright";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

const runtimeDataExclude = ["**/node_modules/**", "apps/server/.data/**"];

export default defineConfig({
  test: {
    allowOnly: false,
    retry: 0,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    projects: [
      {
        test: {
          // oxlint JS plugin rules. They shell out to the real binary, so they belong to
          // the lint pass rather than to any application test tier.
          name: "lint-rules",
          environment: "node",
          include: ["scripts/**/*.rule.test.mjs"],
        },
      },
      {
        test: {
          name: "node-unit",
          environment: "node",
          include: ["{apps,packages}/**/*.unit.test.ts"],
          exclude: runtimeDataExclude,
        },
      },
      {
        test: {
          name: "node-contract",
          environment: "node",
          include: ["{apps,packages}/**/*.contract.test.ts"],
          exclude: runtimeDataExclude,
        },
      },
      {
        test: {
          name: "node-integration",
          environment: "node",
          include: ["{apps,packages}/**/*.integration.test.ts"],
          exclude: runtimeDataExclude,
        },
      },
      {
        plugins: [vue()],
        publicDir: "apps/web/public",
        test: {
          name: "browser-ui",
          include: ["apps/**/*.browser.test.ts"],
          exclude: runtimeDataExclude,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
