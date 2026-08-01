import { Schema } from "effect";
import { createError, defineEventHandler, getRouterParam } from "h3";

import { ThreadId } from "@metaclanker/contracts/ids";

import { decodeBody, publicError } from "../../../utils/http.js";
import { previewFileRestore } from "../../../utils/orchestrator.js";

const PreviewRequest = Schema.Struct({ checkpointId: Schema.String });

export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined)
    throw createError({ statusCode: 400, statusMessage: "Thread ID required" });
  const input = await decodeBody(event, PreviewRequest);
  return previewFileRestore(ThreadId.make(rawId), input.checkpointId).catch((cause: unknown) => {
    throw publicError(cause);
  });
});
