import { defineEventHandler } from "h3";

import { ThreadId } from "@metaclanker/contracts/ids";
import { PersistedCheckpointWire, RestoreThreadFilesRequest } from "@metaclanker/contracts/wire";

import { decodeBody, decodeRouteParam, encodeResponse, publicError } from "../../../utils/http.js";
import { runAgentCommand } from "../../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const id = await decodeRouteParam(event, "id", ThreadId);
  const input = await decodeBody(event, RestoreThreadFilesRequest);
  return runAgentCommand((commands) =>
    commands.restoreThreadFiles(input.commandId, id, input.checkpointId),
  )
    .then((checkpoint) => encodeResponse(PersistedCheckpointWire, checkpoint))
    .catch((cause: unknown) => {
      throw publicError(cause);
    });
});
