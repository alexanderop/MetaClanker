export default {
  plugins: ["@stryker-mutator/vitest-runner"],
  mutate: ["packages/domain/src/graph.ts", "packages/domain/src/thread.ts"],
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.mutation.config.ts",
  },
  reporters: ["clear-text", "progress", "html"],
  coverageAnalysis: "off",
  thresholds: { high: 80, low: 70, break: 70 },
  tempDirName: ".stryker-tmp",
  ignorePatterns: [
    "/artifacts/**",
    "/.packaging/**",
    "/apps/*/dist/**",
    "/apps/server/.output/**",
    "/test-results/**",
  ],
};
