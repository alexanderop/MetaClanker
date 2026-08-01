import { createError, defineEventHandler, getRouterParam } from "h3";

import { ThreadId } from "@metaclanker/contracts/ids";

import { publicError } from "../../../utils/http.js";
import { reviewThread } from "../../../utils/orchestrator.js";

export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined)
    throw createError({ statusCode: 400, statusMessage: "Thread ID required" });
  return reviewThread(ThreadId.make(rawId)).catch((cause: unknown) => {
    throw publicError(cause);
  });
});
