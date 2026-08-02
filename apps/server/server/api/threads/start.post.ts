import { createError } from "h3";

import { StartThreadRequest } from "@metaclanker/contracts/wire";

import { decodeBody, defineApiHandler } from "../../utils/http.js";
import { runAgentCommand } from "../../utils/runtime.js";

export default defineApiHandler(async (event) => {
  const input = await decodeBody(event, StartThreadRequest);
  if (input.prompt.trim().length === 0 && (input.attachments?.length ?? 0) === 0) {
    throw createError({ statusCode: 400, message: "A prompt or attachment is required" });
  }
  return runAgentCommand((commands) =>
    commands.startThread({
      commandId: input.commandId,
      projectId: input.projectId,
      provider: input.provider,
      model: input.model ?? null,
      effort: input.effort ?? null,
      permissionMode: input.permissionMode ?? null,
      prompt: input.prompt,
      attachments: input.attachments ?? [],
    }),
  );
});
