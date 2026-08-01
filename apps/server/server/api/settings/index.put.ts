import { Effect } from "effect";
import { defineEventHandler } from "h3";

import { Store } from "@metaclanker/application/commands";
import { UserSettings } from "@metaclanker/contracts/wire";

import { decodeBody, publicError } from "../../utils/http.js";
import { runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const input = await decodeBody(event, UserSettings);
  return runApplication(
    Effect.gen(function* () {
      const store = yield* Store;
      return yield* store.saveSettings(input);
    }),
  ).catch((cause: unknown) => {
    throw publicError(cause);
  });
});
