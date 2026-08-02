import { createError, getRouterParam } from "h3";

import { getThread } from "@metaclanker/application/workspace";
import { ThreadId } from "@metaclanker/contracts/ids";

import { defineApiHandler } from "../../utils/http.js";
import { runApplication } from "../../utils/runtime.js";

export default defineApiHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined) throw createError({ statusCode: 400, message: "Thread ID required" });
  const id = ThreadId.make(rawId);
  const detail = await runApplication(getThread(id));
  if (detail === null) throw createError({ statusCode: 404, message: "Thread not found" });
  return detail;
});
