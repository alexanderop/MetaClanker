import { defineEventHandler } from "h3";

import { removeProject } from "@metaclanker/application/projects";
import { ProjectId } from "@metaclanker/contracts/ids";
import { RemovedResponse } from "@metaclanker/contracts/wire";

import { decodeRouteParam, encodeResponse, publicError } from "../../utils/http.js";
import { publishShellEvent } from "../../utils/hub.js";
import { runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const id = await decodeRouteParam(event, "id", ProjectId);
  const result = await runApplication(removeProject(id)).catch((cause: unknown) => {
    throw publicError(cause);
  });
  await publishShellEvent({
    type: "project-removed",
    projectId: result.record,
    sequence: result.eventSequence,
  });
  return encodeResponse(RemovedResponse, { removed: true });
});
