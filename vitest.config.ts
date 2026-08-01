import { playwright } from "@vitest/browser-playwright";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

const runtimeDataExclude = ["apps/server/.data/**"];

export default defineConfig({
  test: {
    passWithNoTests: true,
    retry: 0,
    projects: [
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
