import { createError, defineEventHandler, getRouterParam } from "h3";

import { PendingInteractionId } from "@metaclanker/contracts/ids";
import { RespondInteractionRequest } from "@metaclanker/contracts/wire";

import { decodeBody, publicError } from "../../../utils/http.js";
import { respondToInteraction } from "../../../utils/orchestrator.js";

export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined)
    throw createError({ statusCode: 400, statusMessage: "Interaction ID required" });
  const input = await decodeBody(event, RespondInteractionRequest);
  if (input.interactionId !== rawId) {
    throw createError({ statusCode: 409, statusMessage: "Interaction ID mismatch" });
  }
  return respondToInteraction(
    input.commandId,
    PendingInteractionId.make(rawId),
    input.optionId,
  ).catch((cause: unknown) => {
    throw publicError(cause);
  });
});
