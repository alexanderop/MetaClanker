import { createError, getRouterParam } from "h3";

import { ThreadId } from "@metaclanker/contracts/ids";
import { CancelPromptRequest } from "@metaclanker/contracts/wire";

import { decodeBody, defineApiHandler } from "../../../utils/http.js";
import { runAgentCommand } from "../../../utils/runtime.js";

export default defineApiHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined) throw createError({ statusCode: 400, message: "Thread ID required" });
  const input = await decodeBody(event, CancelPromptRequest);
  await runAgentCommand((commands) => commands.cancelPrompt(input.commandId, ThreadId.make(rawId)));
  return { accepted: true };
});
