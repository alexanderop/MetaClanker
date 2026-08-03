import assert from "node:assert/strict";
import { test } from "node:test";

import { unknownErrorChannels } from "./check-typed-errors.mjs";

test("flags an unknown error channel on a declared Effect", () => {
  const found = unknownErrorChannels(
    `import * as Effect from "effect/Effect";
     export const run = (): Effect.Effect<void, unknown, never> => Effect.void;`,
    "example.ts",
  );

  assert.deepEqual(
    found.map((entry) => entry.reference),
    ["Effect"],
  );
});

test("flags unknown hidden inside an error union", () => {
  const found = unknownErrorChannels(
    `export declare const layer: Layer.Layer<Store, StoreError | unknown>;`,
    "example.ts",
  );

  assert.equal(found.length, 1);
});

test("accepts a declared failure type and ignores unknown elsewhere", () => {
  const found = unknownErrorChannels(
    `export declare const run: Effect.Effect<unknown, StoreError, never>;
     export declare const parse: (value: unknown) => Effect.Effect<void, ParseError>;`,
    "example.ts",
  );

  assert.deepEqual(found, []);
});
