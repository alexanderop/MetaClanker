import { defineEventHandler } from "h3";

import { StartThreadRequest } from "@metaclanker/contracts/wire";

import { decodeBody, publicError } from "../../utils/http.js";
import { startThreadWithPrompt } from "../../utils/orchestrator.js";

export default defineEventHandler(async (event) => {
  const input = await decodeBody(event, StartThreadRequest);
  if (input.prompt.trim().length === 0 && (input.attachments?.length ?? 0) === 0) {
    throw new Error("A prompt or attachment is required");
  }
  return startThreadWithPrompt({
    commandId: input.commandId,
    projectId: input.projectId,
    provider: input.provider,
    model: input.model ?? null,
    effort: input.effort ?? null,
    permissionMode: input.permissionMode ?? null,
    prompt: input.prompt,
    attachments: input.attachments ?? [],
  }).catch((cause: unknown) => {
    throw publicError(cause);
  });
});
