import { Effect } from "effect";
import { createError, defineEventHandler, getRouterParam } from "h3";

import { Store } from "@metaclanker/application/commands";
import { ThreadId } from "@metaclanker/contracts/ids";
import { UpdateThreadRequest } from "@metaclanker/contracts/wire";

import { decodeBody, publicError } from "../../utils/http.js";
import { runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined)
    throw createError({ statusCode: 400, statusMessage: "Thread ID required" });
  const input = await decodeBody(event, UpdateThreadRequest);
  return runApplication(
    Effect.gen(function* () {
      const store = yield* Store;
      const id = ThreadId.make(rawId);
      let thread = yield* store.getThread(id);
      if (thread === null) return yield* Effect.fail({ message: "Thread not found" });
      if (input.title !== undefined) {
        yield* store.renameThread(id, input.title);
      }
      if (input.archived !== undefined) {
        yield* store.setThreadArchived(id, input.archived);
      }
      thread = yield* store.getThread(id);
      if (thread === null) return yield* Effect.fail({ message: "Thread not found" });
      return thread.thread;
    }),
  ).catch((cause: unknown) => {
    throw publicError(cause);
  });
});
