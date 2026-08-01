import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/domain/src/**/*.unit.test.ts"],
    retry: 0,
  },
});
