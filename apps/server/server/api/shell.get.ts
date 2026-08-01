import { Effect } from "effect";
import { defineEventHandler } from "h3";

import { Store } from "@metaclanker/application/commands";

import { publicError } from "../utils/http.js";
import { runApplication } from "../utils/runtime.js";

export default defineEventHandler(() =>
  runApplication(
    Effect.gen(function* () {
      const store = yield* Store;
      return yield* store.shellSnapshot;
    }),
  ).catch((cause: unknown) => {
    throw publicError(cause);
  }),
);
