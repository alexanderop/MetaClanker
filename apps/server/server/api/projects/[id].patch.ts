import { createError, defineEventHandler, getRouterParam } from "h3";

import { updateProject } from "@metaclanker/application/projects";
import { ProjectId } from "@metaclanker/contracts/ids";
import { UpdateProjectRequest } from "@metaclanker/contracts/wire";

import { decodeBody, publicError } from "../../utils/http.js";
import { publishShellEvent } from "../../utils/hub.js";
import { runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined) throw createError({ statusCode: 400, message: "Project ID required" });
  const input = await decodeBody(event, UpdateProjectRequest);
  const result = await runApplication(updateProject(ProjectId.make(rawId), input)).catch(
    (cause: unknown) => {
      throw publicError(cause);
    },
  );
  publishShellEvent({
    type: "project-upserted",
    sequence: result.eventSequence,
    project: result.record,
  });
  return result.record;
});
