import { createError, defineEventHandler, getRouterParam } from "h3";

import { ThreadId } from "@metaclanker/contracts/ids";

import { publicError } from "../../../utils/http.js";
import { cancelPrompt } from "../../../utils/orchestrator.js";

export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined)
    throw createError({ statusCode: 400, statusMessage: "Thread ID required" });
  await cancelPrompt(ThreadId.make(rawId)).catch((cause: unknown) => {
    throw publicError(cause);
  });
  return { accepted: true };
});
