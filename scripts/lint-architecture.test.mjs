import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { architectureViolationForImport, importedSpecifiers } from "./lint-architecture.mjs";

const root = resolve(import.meta.dirname, "..");

test("rejects web boundary bypasses through the @ alias", () => {
  const importer = resolve(root, "apps/web/src/shared/session.ts");

  assert.equal(
    architectureViolationForImport(importer, "@/features/threads/model.js", root),
    "web shared code cannot import features or views",
  );
  assert.equal(
    architectureViolationForImport(importer, "@/views/ThreadView.vue", root),
    "web shared code cannot import features or views",
  );
});

test("rejects a nested relative import into another feature", () => {
  const importer = resolve(root, "apps/web/src/features/projects/components/ProjectCard.vue");

  assert.equal(
    architectureViolationForImport(importer, "../../threads/model.js", root),
    "web features cannot import views or other features",
  );
  assert.equal(architectureViolationForImport(importer, "../model.js", root), null);
});

test("resolves relative cross-package imports before enforcing core boundaries", () => {
  const importer = resolve(root, "packages/domain/src/events.ts");

  assert.equal(
    architectureViolationForImport(importer, "../../persistence/src/database.js", root),
    "core packages cannot import infrastructure implementations",
  );
  assert.equal(
    architectureViolationForImport(importer, "@metaclanker/server/runtime", root),
    "core packages cannot import infrastructure implementations",
  );
});

test("extracts static, re-export, and dynamic imports from Vue script blocks", () => {
  const source = `<template><div /></template>
    <script setup lang="ts">
      import value from "@/features/one/model.js";
      export { other } from "@/features/two/model.js";
      const lazy = import("@/views/LazyView.vue");
    </script>`;

  assert.deepEqual(importedSpecifiers(source, "Component.vue"), [
    "@/features/one/model.js",
    "@/features/two/model.js",
    "@/views/LazyView.vue",
  ]);
});

test("keeps Atom and Effect runtime APIs behind project-owned Vue facades", () => {
  const component = resolve(root, "apps/web/src/features/conversation/ReviewPanel.vue");
  const model = resolve(root, "apps/web/src/features/conversation/review-model.ts");
  const primitive = resolve(root, "apps/web/src/ui/button/Button.vue");

  assert.equal(
    architectureViolationForImport(component, "@effect/atom-vue", root),
    "Vue SFCs cannot import Atom or Effect runtime modules",
  );
  assert.equal(
    architectureViolationForImport(component, "effect/Effect", root),
    "Vue SFCs cannot import Atom or Effect runtime modules",
  );
  assert.equal(
    architectureViolationForImport(model, "effect/unstable/reactivity/Atom", root),
    "web code must use the public Atom Vue re-exports",
  );
  assert.equal(
    architectureViolationForImport(primitive, "@effect/atom-vue", root),
    "Vue SFCs cannot import Atom or Effect runtime modules",
  );
});
