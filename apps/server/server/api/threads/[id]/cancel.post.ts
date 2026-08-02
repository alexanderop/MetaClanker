import { createError, getRouterParam } from "h3";

import { ThreadId } from "@metaclanker/contracts/ids";

import { defineApiHandler } from "../../../utils/http.js";
import { runAgentCommand } from "../../../utils/runtime.js";

export default defineApiHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined) throw createError({ statusCode: 400, message: "Thread ID required" });
  await runAgentCommand((commands) => commands.cancelPrompt(ThreadId.make(rawId)));
  return { accepted: true };
});
