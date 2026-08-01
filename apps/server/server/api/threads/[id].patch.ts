import { Effect } from "effect";
import { createError, defineEventHandler, getRouterParam } from "h3";

import { Store } from "@metaclanker/application/commands";
import { ThreadId } from "@metaclanker/contracts/ids";
import { UpdateThreadRequest } from "@metaclanker/contracts/wire";

import { decodeBody, publicError } from "../../utils/http.js";
import { publishShellEvent, publishThreadEvent } from "../../utils/hub.js";
import { runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined)
    throw createError({ statusCode: 400, statusMessage: "Thread ID required" });
  const input = await decodeBody(event, UpdateThreadRequest);
  const result = await runApplication(
    Effect.gen(function* () {
      const store = yield* Store;
      const id = ThreadId.make(rawId);
      const existing = yield* store.getThread(id);
      if (existing === null) return yield* Effect.fail({ message: "Thread not found" });
      const mutations = [];
      if (input.title !== undefined) {
        mutations.push(yield* store.renameThread(id, input.title));
      }
      if (input.archived !== undefined) {
        mutations.push(yield* store.setThreadArchived(id, input.archived));
      }
      return { thread: mutations.at(-1)?.record ?? existing.thread, mutations };
    }),
  ).catch((cause: unknown) => {
    throw publicError(cause);
  });
  for (const mutation of result.mutations) {
    const liveEvent = {
      type: "thread-upserted",
      sequence: mutation.eventSequence,
      thread: mutation.record,
    } as const;
    publishShellEvent(liveEvent);
    publishThreadEvent(result.thread.id, liveEvent);
  }
  return result.thread;
});
