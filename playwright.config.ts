import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4401",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node tests/e2e/start-server.mjs",
    url: "http://127.0.0.1:4401/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
