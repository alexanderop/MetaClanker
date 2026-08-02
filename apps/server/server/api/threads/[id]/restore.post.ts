import { createError, defineEventHandler, getRouterParam } from "h3";

import { ThreadId } from "@metaclanker/contracts/ids";
import { RestoreThreadFilesRequest } from "@metaclanker/contracts/wire";

import { decodeBody, publicError } from "../../../utils/http.js";
import { runAgentCommand } from "../../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined) throw createError({ statusCode: 400, message: "Thread ID required" });
  const input = await decodeBody(event, RestoreThreadFilesRequest);
  return runAgentCommand((commands) =>
    commands.restoreThreadFiles(input.commandId, ThreadId.make(rawId), input.checkpointId),
  ).catch((cause: unknown) => {
    throw publicError(cause);
  });
});
