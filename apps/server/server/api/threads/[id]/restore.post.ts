import { Schema } from "effect";
import { createError, defineEventHandler, getRouterParam } from "h3";

import { ThreadId } from "@metaclanker/contracts/ids";

import { decodeBody, publicError } from "../../../utils/http.js";
import { restoreThreadFiles } from "../../../utils/orchestrator.js";

const RestoreRequest = Schema.Struct({
  checkpointId: Schema.String,
  confirmed: Schema.Literal(true),
});

export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined)
    throw createError({ statusCode: 400, statusMessage: "Thread ID required" });
  const input = await decodeBody(event, RestoreRequest);
  return restoreThreadFiles(ThreadId.make(rawId), input.checkpointId).catch((cause: unknown) => {
    throw publicError(cause);
  });
});
