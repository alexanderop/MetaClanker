import { createError, defineEventHandler, getRouterParam } from "h3";

import { ThreadId } from "@metaclanker/contracts/ids";
import { reviewThread } from "@metaclanker/application/review";

import { publicError } from "../../../utils/http.js";
import { runApplication } from "../../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined) throw createError({ statusCode: 400, message: "Thread ID required" });
  return runApplication(reviewThread(ThreadId.make(rawId))).catch((cause: unknown) => {
    throw publicError(cause);
  });
});
