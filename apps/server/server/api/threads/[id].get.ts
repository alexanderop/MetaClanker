import { Effect } from "effect";
import { createError, defineEventHandler, getRouterParam } from "h3";

import { Store } from "@metaclanker/application/commands";
import { ThreadId } from "@metaclanker/contracts/ids";

import { publicError } from "../../utils/http.js";
import { runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined)
    throw createError({ statusCode: 400, statusMessage: "Thread ID required" });
  const id = ThreadId.make(rawId);
  const detail = await runApplication(
    Effect.gen(function* () {
      const store = yield* Store;
      return yield* store.getThread(id);
    }),
  ).catch((cause: unknown) => {
    throw publicError(cause);
  });
  if (detail === null) throw createError({ statusCode: 404, statusMessage: "Thread not found" });
  return detail;
});
