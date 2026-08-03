import * as Effect from "effect/Effect";
import { defineEventHandler } from "h3";

import { Store } from "@metaclanker/application/commands";
import { ThreadId } from "@metaclanker/contracts/ids";
import { CreateThreadRequest, Thread } from "@metaclanker/contracts/wire";

import { decodeBody, encodeResponse, publicError } from "../../utils/http.js";
import { publishShellEvent } from "../../utils/hub.js";
import { runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const input = await decodeBody(event, CreateThreadRequest);
  const result = await runApplication(
    Effect.gen(function* () {
      const store = yield* Store;
      const now = new Date().toISOString();
      return yield* store.createThread({
        id: ThreadId.make(crypto.randomUUID()),
        commandId: input.commandId,
        projectId: input.projectId,
        provider: input.provider,
        title: input.title ?? "New conversation",
        model: input.model ?? null,
        createdAt: now,
      });
    }),
  ).catch((cause: unknown) => {
    throw publicError(cause);
  });
  if (result.eventSequence !== null) {
    await publishShellEvent({
      type: "thread-upserted",
      sequence: result.eventSequence,
      thread: result.record,
    });
  }
  return encodeResponse(Thread, result.record);
});
