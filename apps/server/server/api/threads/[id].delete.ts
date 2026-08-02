import { createError, getRouterParam } from "h3";

import { deleteThread } from "@metaclanker/application/workspace";
import { ThreadId } from "@metaclanker/contracts/ids";

import { defineApiHandler } from "../../utils/http.js";
import { publishShellEvent, publishThreadEvent } from "../../utils/hub.js";
import { runApplication } from "../../utils/runtime.js";

export default defineApiHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined) throw createError({ statusCode: 400, message: "Thread ID required" });
  const result = await runApplication(deleteThread(ThreadId.make(rawId)));
  const liveEvent = {
    type: "thread-removed",
    threadId: result.record,
    sequence: result.eventSequence,
  } as const;
  publishShellEvent(liveEvent);
  publishThreadEvent(result.record, liveEvent);
  return { removed: true };
});
