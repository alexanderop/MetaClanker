import { createError, getRouterParam } from "h3";

import { PendingInteractionId } from "@metaclanker/contracts/ids";
import { RespondInteractionRequest } from "@metaclanker/contracts/wire";

import { decodeBody, defineApiHandler } from "../../../utils/http.js";
import { runAgentCommand } from "../../../utils/runtime.js";

export default defineApiHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined)
    throw createError({ statusCode: 400, message: "Interaction ID required" });
  const input = await decodeBody(event, RespondInteractionRequest);
  if (input.interactionId !== rawId) {
    throw createError({ statusCode: 409, message: "Interaction ID mismatch" });
  }
  return runAgentCommand((commands) =>
    commands.respondToInteraction(
      input.commandId,
      PendingInteractionId.make(rawId),
      input.optionId,
    ),
  );
});
