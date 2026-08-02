import { createError, getRouterParam } from "h3";

import { ThreadId } from "@metaclanker/contracts/ids";
import { SendPromptRequest } from "@metaclanker/contracts/wire";

import { decodeBody, defineApiHandler } from "../../../utils/http.js";
import { runAgentCommand } from "../../../utils/runtime.js";

export default defineApiHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined) throw createError({ statusCode: 400, message: "Thread ID required" });
  const input = await decodeBody(event, SendPromptRequest);
  if (input.threadId !== rawId)
    throw createError({ statusCode: 409, message: "Thread ID mismatch" });
  return runAgentCommand((commands) =>
    commands.dispatchPrompt(
      input.commandId,
      ThreadId.make(rawId),
      input.prompt,
      input.attachments ?? [],
    ),
  ).then((turnId) => ({ accepted: true, turnId }));
});
