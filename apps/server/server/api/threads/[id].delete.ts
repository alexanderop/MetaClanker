import { Effect } from "effect";
import { createError, defineEventHandler, getRouterParam } from "h3";

import { Store } from "@metaclanker/application/commands";
import { ThreadId } from "@metaclanker/contracts/ids";

import { publicError } from "../../utils/http.js";
import { publishShellEvent, publishThreadEvent } from "../../utils/hub.js";
import { runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined)
    throw createError({ statusCode: 400, statusMessage: "Thread ID required" });
  const result = await runApplication(
    Effect.gen(function* () {
      const store = yield* Store;
      return yield* store.deleteThread(ThreadId.make(rawId));
    }),
  ).catch((cause: unknown) => {
    throw publicError(cause);
  });
  const liveEvent = {
    type: "thread-removed",
    threadId: result.record,
    sequence: result.eventSequence,
  } as const;
  publishShellEvent(liveEvent);
  publishThreadEvent(result.record, liveEvent);
  return { removed: true };
});
