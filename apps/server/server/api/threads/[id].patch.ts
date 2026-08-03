import * as Effect from "effect/Effect";
import { defineEventHandler } from "h3";

import { ApplicationError, Store } from "@metaclanker/application/commands";
import { ThreadId } from "@metaclanker/contracts/ids";
import { Thread, UpdateThreadRequest } from "@metaclanker/contracts/wire";

import { decodeBody, decodeRouteParam, encodeResponse, publicError } from "../../utils/http.js";
import { publishShellEvent, publishThreadEvent } from "../../utils/hub.js";
import { runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const id = await decodeRouteParam(event, "id", ThreadId);
  const input = await decodeBody(event, UpdateThreadRequest);
  const result = await runApplication(
    Effect.gen(function* () {
      const store = yield* Store;
      const existing = yield* store.getThread(id);
      if (existing === null) {
        return yield* Effect.fail(
          new ApplicationError({ code: "not-found", message: "Thread not found" }),
        );
      }
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
    await publishShellEvent(liveEvent);
    await publishThreadEvent(result.thread.id, liveEvent);
  }
  return encodeResponse(Thread, result.thread);
});
