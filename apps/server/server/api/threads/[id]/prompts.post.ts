import { createError, defineEventHandler, getRouterParam } from "h3";

import { ThreadId } from "@metaclanker/contracts/ids";
import { SendPromptRequest } from "@metaclanker/contracts/wire";

import { decodeBody, publicError } from "../../../utils/http.js";
import { dispatchPrompt } from "../../../utils/orchestrator.js";

export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined)
    throw createError({ statusCode: 400, statusMessage: "Thread ID required" });
  const input = await decodeBody(event, SendPromptRequest);
  if (input.threadId !== rawId)
    throw createError({ statusCode: 409, statusMessage: "Thread ID mismatch" });
  return dispatchPrompt(
    input.commandId,
    ThreadId.make(rawId),
    input.prompt,
    input.attachments ?? [],
  ).then(
    (turnId) => ({ accepted: true, turnId }),
    (cause: unknown) => {
      throw publicError(cause);
    },
  );
});
