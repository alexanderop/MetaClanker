import eslint from "@eslint/js";
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
    files: ["**/*.{ts,cts,vue}"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        project: [
          "./tsconfig.json",
          "./apps/desktop/tsconfig.json",
          "./apps/server/tsconfig.json",
          "./apps/web/tsconfig.app.json",
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
      complexity: "off",
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
    files: ["**/*.config.{js,ts}", "**/*.mjs", "eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { "no-undef": "off" },
  },
  {
    // Electron's sandboxed preload loader requires the emitted entrypoint to be CommonJS.
    files: ["apps/desktop/src/preload.cts"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
