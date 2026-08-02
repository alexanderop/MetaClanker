import eslint from "@eslint/js";
import effect from "@effect/eslint-plugin";
import tseslint from "typescript-eslint";
import vue from "eslint-plugin-vue";

export default tseslint.config(
  {
    ignores: [
      "**/.packaging/**",
      "**/.stryker-tmp/**",
      "**/dist/**",
      "**/.nitro/**",
      "**/.output/**",
      "apps/server/.data/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/public/mockServiceWorker.js",
      "artifacts/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.{ts,tsx,cts,vue}"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        project: [
          "./tsconfig.json",
          "./apps/desktop/tsconfig.json",
          "./apps/server/tsconfig.json",
          "./apps/web/tsconfig.app.json",
          "./examples/*/tsconfig.json",
          "./packages/*/tsconfig.json",
          "./tests/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".vue"],
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      complexity: ["warn", 10],
      "no-undef": "off",
      "no-nested-ternary": "error",
      "vue/html-closing-bracket-newline": "off",
      "vue/html-indent": "off",
      "vue/html-self-closing": "off",
      "vue/max-attributes-per-line": "off",
      "vue/multi-word-component-names": "off",
      "vue/no-v-html": "off",
      "vue/singleline-html-element-content-newline": "off",
    },
  },
  {
    // Effect's named root imports obscure the module boundary and make the
    // dependency surface of an effect harder to read. This starts as a
    // warning because the existing codebase uses the old style extensively;
    // new backend code should use `import * as Effect from "effect/Effect"`.
    files: ["{apps,packages}/**/*.{ts,tsx,cts,vue}"],
    plugins: { effect },
    rules: {
      "effect/no-import-from-barrel-package": ["warn", { packageNames: ["effect"] }],
    },
  },
  {
    files: ["**/*.config.{js,ts}", "**/*.mjs", "eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { "no-undef": "off" },
  },
  {
    // Electron's sandboxed preload loader requires the emitted entrypoint to be CommonJS.
    files: ["apps/desktop/src/preload.cts"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["apps/web/src/shared/**/*.{ts,vue}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?:\\.\\./)+(?:features|views)(?:/|$)",
              message: "Shared web code cannot depend on features or views.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/src/ui/**/*.{ts,vue}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?:\\.\\./)+(?:features|views|shared)(?:/|$)",
              message: "UI primitives cannot depend on shared state, features, or views.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/src/features/**/*.{ts,vue}"],
    ignores: ["apps/web/src/features/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^\\.\\./(?!\\.)",
              message: "Features cannot import sibling features; compose them in a view.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/{contracts,domain,application}/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@metaclanker/(?:acp-client|git|persistence|server)(?:/|$)",
              message: "Core packages cannot depend on infrastructure implementations.",
            },
          ],
        },
      ],
    },
  },
  {
    // Backend workflows model expected failures in Effect's error channel. Keep
    // native try/catch at framework and test boundaries outside this scope.
    files: [
      "apps/server/server/**/*.ts",
      "packages/{application,domain,acp-client,persistence,git}/src/**/*.ts",
    ],
    ignores: ["**/*.test.ts", "apps/server/server/test-support/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TryStatement[handler!=null]",
          message:
            "Use Effect.try, Effect.tryPromise, Effect.catch, or Effect.catchTag with typed errors.",
        },
      ],
    },
  },
);
