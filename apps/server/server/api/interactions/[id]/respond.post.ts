import { createError } from "h3";

import { PendingInteractionId } from "@metaclanker/contracts/ids";
import { PendingInteraction, RespondInteractionRequest } from "@metaclanker/contracts/wire";

import {
  decodeBody,
  decodeRouteParam,
  defineApiHandler,
  encodeResponse,
} from "../../../utils/http.js";
import { runAgentCommand } from "../../../utils/runtime.js";

export default defineApiHandler(async (event) => {
  const id = await decodeRouteParam(event, "id", PendingInteractionId);
  const input = await decodeBody(event, RespondInteractionRequest);
  if (input.interactionId !== id) {
    throw createError({ statusCode: 409, message: "Interaction ID mismatch" });
  }
  return runAgentCommand((commands) =>
    commands.respondToInteraction(input.commandId, id, input.optionId),
  ).then((interaction) => encodeResponse(PendingInteraction, interaction));
});
