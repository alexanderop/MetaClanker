import { createError } from "h3";

import { ThreadId } from "@metaclanker/contracts/ids";
import { AcceptedTurnResponse, SendPromptRequest } from "@metaclanker/contracts/wire";

import {
  decodeBody,
  decodeRouteParam,
  defineApiHandler,
  encodeResponse,
} from "../../../utils/http.js";
import { runAgentCommand } from "../../../utils/runtime.js";

export default defineApiHandler(async (event) => {
  const id = await decodeRouteParam(event, "id", ThreadId);
  const input = await decodeBody(event, SendPromptRequest);
  if (input.threadId !== id) throw createError({ statusCode: 409, message: "Thread ID mismatch" });
  return runAgentCommand((commands) =>
    commands.dispatchPrompt(input.commandId, id, input.prompt, input.attachments ?? []),
  ).then((turnId) => encodeResponse(AcceptedTurnResponse, { accepted: true, turnId }));
});
