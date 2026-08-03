import { defineEventHandler } from "h3";

import { updateProject } from "@metaclanker/application/projects";
import { ProjectId } from "@metaclanker/contracts/ids";
import { Project, UpdateProjectRequest } from "@metaclanker/contracts/wire";

import { decodeBody, decodeRouteParam, encodeResponse, publicError } from "../../utils/http.js";
import { publishShellEvent } from "../../utils/hub.js";
import { runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const id = await decodeRouteParam(event, "id", ProjectId);
  const input = await decodeBody(event, UpdateProjectRequest);
  const result = await runApplication(updateProject(id, input)).catch((cause: unknown) => {
    throw publicError(cause);
  });
  await publishShellEvent({
    type: "project-upserted",
    sequence: result.eventSequence,
    project: result.record,
  });
  return encodeResponse(Project, result.record);
});
